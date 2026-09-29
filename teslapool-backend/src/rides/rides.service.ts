import { Prisma, type PaymentMethod, type PrismaClient, type RideRequest } from '@prisma/client';
import type { AppConfig } from '../config/env';
import { isUniqueViolation, withTransaction } from '../common/db';
import type { AuthPrincipal } from '../common/express-augment';
import { badRequest, conflict, ErrorCode, forbidden, notFound } from '../common/errors';
import { logger } from '../common/logger';
import type { DistanceProvider } from '../geography/distance-provider';
import type { Zone } from '../geography/zones';
import { lockRideWithPool, syncPoolStatus } from '../pools/pool-ops';
import type { PoolService, PricedDecision } from '../pools/pools.service';
import { PredictionFeatures, TimeOfDay, TrafficLevel, timeOfDayAt, typicalTraffic, VehicleType, Weather } from '../predictions/features';
import type { PredictionResult, PredictionService } from '../predictions/prediction.service';
import { insufficientBalance, Settlement, settleRide } from '../payments/payments.service';
import { appendRideEvents, RideEventType } from '../ride-events/ride-events';
import { ACTIVE_RIDE_STATUSES, assertTransition, InvalidTransition, RideStatus } from './ride-state-machine';

export interface CreateRideInput {
  pickupZone: Zone;
  dropoffZone: Zone;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  requestedSeats: number;
  vehicleType?: VehicleType;
  paymentMethod?: PaymentMethod;
  context?: { traffic?: TrafficLevel; weather?: Weather; timeOfDay?: TimeOfDay };
}

const MAX_POOL_OPTIONS = 5;
type LifecycleTarget = Extract<RideStatus, 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED'>;

export class RideService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: AppConfig,
    private readonly distance: DistanceProvider,
    private readonly predictions: PredictionService,
    private readonly pools: PoolService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Request-time features. Distance is computed server-side; surge is platform-controlled, never client-supplied. */
  buildFeatures(input: Pick<CreateRideInput, 'pickupZone' | 'dropoffZone' | 'vehicleType' | 'context'>): PredictionFeatures {
    const timeOfDay = input.context?.timeOfDay ?? timeOfDayAt(this.now());
    return {
      vehicleType: input.vehicleType ?? this.cfg.context.defaultVehicleType,
      pickupZone: input.pickupZone,
      dropoffZone: input.dropoffZone,
      distanceKm: this.distance.distanceKm(input.pickupZone, input.dropoffZone),
      traffic: input.context?.traffic ?? typicalTraffic(timeOfDay),
      weather: input.context?.weather ?? this.cfg.context.defaultWeather,
      timeOfDay,
      surgeMultiplier: this.cfg.context.surgeMultiplier,
    };
  }

  async create(actor: AuthPrincipal, input: CreateRideInput): Promise<{ ride: RideRequest; prediction: PredictionResult; poolOptions: PricedDecision[] }> {
    if (input.pickupZone === input.dropoffZone) throw badRequest(ErrorCode.SAME_PICKUP_AND_DROPOFF, 'Pickup and dropoff zones must differ.');
    const active = await this.prisma.rideRequest.findFirst({ where: { passengerId: actor.userId, status: { in: ACTIVE_RIDE_STATUSES } }, select: { id: true, status: true } });
    if (active) throw conflict(ErrorCode.ACTIVE_RIDE_EXISTS, 'You already have a ride in progress.', { rideRequestId: active.id, status: active.status });

    // 1. Predict OUTSIDE any transaction (network call, may be slow or fail -> deterministic fallback).
    const features = this.buildFeatures(input);
    const prediction = await this.predictions.predict(features, this.distance.source);

    // TeslaPay: the solo quote is an upper bound of what the ride can cost (pool discounts only lower it).
    const paymentMethod = input.paymentMethod ?? 'CASH';
    if (paymentMethod === 'TESLAPAY') {
      const { walletBalancePoysha } = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { walletBalancePoysha: true } });
      if (walletBalancePoysha < prediction.fare.finalFarePoysha) throw insufficientBalance(prediction.fare.finalFarePoysha, walletBalancePoysha);
    }

    // 2. Persist ride + audit event + prediction log atomically.
    let ride: RideRequest;
    try {
      ride = await withTransaction(this.prisma, async (tx) => {
        const created = await tx.rideRequest.create({
          data: {
            passengerId: actor.userId,
            pickupZone: input.pickupZone,
            dropoffZone: input.dropoffZone,
            pickupLat: input.pickupLat ?? null,
            pickupLng: input.pickupLng ?? null,
            dropoffLat: input.dropoffLat ?? null,
            dropoffLng: input.dropoffLng ?? null,
            requestedSeats: input.requestedSeats,
            vehicleType: features.vehicleType,
            estimatedDistanceKm: features.distanceKm,
            distanceSource: prediction.distanceSource,
            estimatedDurationMin: prediction.eta.finalMinutes,
            quotedFarePoysha: prediction.fare.finalFarePoysha,
            fareSource: prediction.fare.source,
            trafficLevel: prediction.fareBreakdown.traffic,
            pricingDurationMin: prediction.fareBreakdown.pricingDurationMin,
            baseFarePoysha: prediction.fareBreakdown.basePoysha,
            distanceChargePoysha: prediction.fareBreakdown.distanceChargePoysha,
            timeChargePoysha: prediction.fareBreakdown.timeChargePoysha,
            paymentMethod,
          },
        });
        await appendRideEvents(tx, [{
          rideRequestId: created.id,
          eventType: RideEventType.RIDE_REQUESTED,
          toStatus: 'REQUESTED',
          actorId: actor.userId,
          metadata: { features, eta: prediction.eta, fare: prediction.fare, mlAvailable: prediction.mlAvailable },
        }]);
        await tx.predictionEvent.createMany({
          data: prediction.events.map((e) => ({
            rideRequestId: created.id,
            modelName: e.modelName,
            modelVersion: e.modelVersion,
            predictionType: e.predictionType,
            predictionValue: e.predictionValue,
            usedForDecision: e.usedForDecision,
            featureSnapshot: e.featureSnapshot as unknown as Prisma.InputJsonValue,
            metadata: e.metadata as Prisma.InputJsonValue,
            latencyMs: e.latencyMs,
          })),
        });
        return created;
      });
    } catch (err) {
      // The partial unique index is the real guard against concurrent duplicate submissions.
      if (isUniqueViolation(err, 'ride_requests_one_active_per_passenger')) throw conflict(ErrorCode.ACTIVE_RIDE_EXISTS, 'You already have a ride in progress.');
      throw err;
    }
    logger.info('ride.requested', { event: 'RIDE_REQUESTED', rideRequestId: ride.id, fareSource: prediction.fare.source, etaSource: prediction.eta.source });

    // 3. Advisory pool options (read-only; joining re-validates under lock).
    const poolOptions = (await this.pools.evaluateOptions(ride)).slice(0, MAX_POOL_OPTIONS);
    return { ride, prediction, poolOptions };
  }

  /** Visible to the passenger, admins, and the driver of a pool this ride is or was in. */
  async getVisible(actor: AuthPrincipal, rideId: string) {
    const ride = await this.prisma.rideRequest.findUnique({
      where: { id: rideId },
      include: { payment: true, memberships: { orderBy: { joinedAt: 'desc' }, include: { pool: { select: { id: true, driverId: true, status: true } } } } },
    });
    if (!ride) throw notFound(ErrorCode.RIDE_NOT_FOUND, 'Ride not found.');
    const isDriver = ride.memberships.some((m) => m.pool.driverId === actor.userId);
    if (ride.passengerId !== actor.userId && actor.role !== 'ADMIN' && !isDriver) throw forbidden('You cannot access this ride.');
    return ride;
  }

  async list(actor: AuthPrincipal, page: number, limit: number, status?: RideStatus | 'ACTIVE') {
    const scope: Prisma.RideRequestWhereInput =
      actor.role === 'ADMIN' ? {} : actor.role === 'DRIVER' ? { memberships: { some: { pool: { driverId: actor.userId } } } } : { passengerId: actor.userId };
    const where: Prisma.RideRequestWhereInput = {
      ...scope,
      ...(status === undefined ? {} : status === 'ACTIVE' ? { status: { in: ACTIVE_RIDE_STATUSES } } : { status }),
    };
    const [items, total] = await Promise.all([
      this.prisma.rideRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { payment: true, memberships: { orderBy: { joinedAt: 'desc' }, include: { pool: { select: { id: true, driverId: true, status: true } } } } },
      }),
      this.prisma.rideRequest.count({ where }),
    ]);
    return { items, total };
  }

  async match(actor: AuthPrincipal, rideId: string) {
    const ride = await this.getVisible(actor, rideId);
    if (ride.passengerId !== actor.userId && actor.role !== 'ADMIN') throw forbidden('Only the passenger can match this ride.');
    return this.pools.autoMatch(actor, ride);
  }

  /** Passenger (or admin) cancels. Allowed from REQUESTED, MATCHED, DRIVER_ARRIVED; never once STARTED. */
  async cancel(actor: AuthPrincipal, rideId: string, reason?: string) {
    return withTransaction(this.prisma, async (tx) => {
      const { ride, membership } = await lockRideWithPool(tx, rideId);
      if (ride.passengerId !== actor.userId && actor.role !== 'ADMIN') throw forbidden('You can only cancel your own ride.');
      assertTransition(ride.status, 'CANCELLED');

      const updated = await tx.rideRequest.update({ where: { id: rideId }, data: { status: 'CANCELLED' } });
      const events = [];
      if (membership) {
        await tx.poolMembership.update({ where: { id: membership.id }, data: { status: 'CANCELLED', endedAt: new Date() } });
        events.push(...(await this.pools.replanWithout(tx, membership.poolId, rideId, actor.userId, 'CANCEL')));
      }
      await appendRideEvents(tx, [
        { rideRequestId: rideId, poolId: membership?.poolId ?? null, eventType: RideEventType.STATUS_CHANGED, fromStatus: ride.status, toStatus: 'CANCELLED', actorId: actor.userId, metadata: { cause: 'CANCELLED', reason: reason ?? null } },
        ...events,
      ]);
      logger.info('ride.cancelled', { event: 'RIDE_CANCELLED', rideRequestId: rideId, poolId: membership?.poolId });
      return updated;
    });
  }

  /** Driver lifecycle: arrive -> start -> complete. Only the driver of the ride's pool (or an admin). */
  async advance(actor: AuthPrincipal, rideId: string, to: LifecycleTarget) {
    return withTransaction(this.prisma, async (tx) => {
      const { ride, membership } = await lockRideWithPool(tx, rideId);
      if (!membership) {
        if (actor.role !== 'ADMIN' && ride.passengerId !== actor.userId) {
          // Do not reveal lifecycle details of rides outside the driver's pools.
          const drove = await tx.poolMembership.findFirst({ where: { rideRequestId: rideId, pool: { driverId: actor.userId } }, select: { id: true } });
          if (!drove) throw forbidden('This ride is not in a pool you drive.');
        }
        throw new InvalidTransition(ride.status, to);
      }
      const pool = await tx.pool.findUniqueOrThrow({ where: { id: membership.poolId }, select: { driverId: true } });
      if (pool.driverId !== actor.userId && actor.role !== 'ADMIN') throw forbidden('This ride is not in a pool you drive.');
      assertTransition(ride.status, to);

      const updated = await tx.rideRequest.update({
        where: { id: rideId },
        data: { status: to, ...(to === 'COMPLETED' ? { finalFarePoysha: membership.farePoysha } : {}) },
      });
      let settlement: Settlement | null = null;
      if (to === 'COMPLETED') {
        await tx.poolMembership.update({ where: { id: membership.id }, data: { status: 'COMPLETED', endedAt: new Date() } });
        // Payment is settled in the same transaction as completion: a completed ride always has exactly one payment.
        settlement = await settleRide(tx, ride, pool.driverId, membership.farePoysha);
      }
      const poolStatus = await syncPoolStatus(tx, membership.poolId);
      await appendRideEvents(tx, [{
        rideRequestId: rideId,
        poolId: membership.poolId,
        eventType: RideEventType.STATUS_CHANGED,
        fromStatus: ride.status,
        toStatus: to,
        actorId: actor.userId,
        metadata: { cause: to, poolStatus, ...(settlement ? { finalFarePoysha: membership.farePoysha, payment: settlement } : {}) },
      }]);
      logger.info('ride.status_changed', { event: 'RIDE_STATUS_CHANGED', rideRequestId: rideId, from: ride.status, to, poolId: membership.poolId });
      return updated;
    });
  }

  async events(actor: AuthPrincipal, rideId: string) {
    await this.getVisible(actor, rideId);
    return this.prisma.rideEvent.findMany({ where: { rideRequestId: rideId }, orderBy: { seq: 'asc' }, take: 500 });
  }
}
