import { Prisma, type PrismaClient, type RideRequest } from '@prisma/client';
import type { AppConfig } from '../config/env';
import { isCapacityGuardViolation, isUniqueViolation, lockPool, lockRide, Tx, withTransaction } from '../common/db';
import type { AuthPrincipal } from '../common/express-augment';
import { AppError, conflict, ErrorCode, ErrorCodeValue, forbidden, notFound, unprocessable } from '../common/errors';
import { logger } from '../common/logger';
import { counters, matchLatency } from '../common/metrics';
import { PooledFare, pooledFare } from '../fares/fare-engine';
import type { DistanceProvider } from '../geography/distance-provider';
import type { Zone } from '../geography/zones';
import { appendRideEvents, RideEventType } from '../ride-events/ride-events';
import { assertTransition, InvalidTransition } from '../rides/ride-state-machine';
import type { PlannedPassenger } from '../route-engine/route-planner';
import { bestPlanFor, evaluateCandidate, MatchContext, MatchDecision, MatchReason, rankDecisions } from './matching-engine';
import { activeMembers, loadLockedPool, lockRideWithPool, persistPlan, PoolWithMembers, toSnapshot } from './pool-ops';
import { ACTIVE_POOL_STATUSES, PoolStatus } from './pool-state';

export const POOL_VIEW_INCLUDE = {
  vehicle: true,
  memberships: {
    where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
    include: { rideRequest: true, passenger: { select: { name: true } } },
    orderBy: { joinedAt: 'asc' },
  },
} satisfies Prisma.PoolInclude;
export type PoolView = Prisma.PoolGetPayload<{ include: typeof POOL_VIEW_INCLUDE }>;

export type PricedDecision = MatchDecision & { fare?: PooledFare & { soloFareBdt: number; fareBdt: number } };

export interface AutoMatchResult {
  decision: 'MATCHED' | 'REJECTED';
  reasonCodes: string[];
  match: PricedDecision | null;
  candidatesEvaluated: number;
  candidates: PricedDecision[];
}

/** Order in which a failed hard rule becomes the HTTP error code of an explicit join. */
const REJECTION_PRIORITY: Array<{ code: string; status: number; message: string }> = [
  { code: MatchReason.POOL_ALREADY_STARTED, status: 409, message: 'This pool has already started; new passengers cannot join.' },
  { code: MatchReason.POOL_CANCELLED, status: 409, message: 'This pool was cancelled.' },
  { code: MatchReason.LATE_JOIN_NOT_ALLOWED, status: 409, message: 'The driver has already arrived; late joins are disabled.' },
  { code: MatchReason.CAPACITY_EXCEEDED, status: 409, message: 'The requested number of seats is not available.' },
  { code: MatchReason.PICKUP_TOO_FAR, status: 422, message: 'Your pickup is too far from the pool’s pickups.' },
  { code: MatchReason.DESTINATION_TOO_FAR, status: 422, message: 'Your destination is too far from the pool’s destinations.' },
  { code: MatchReason.MAX_STOPS_EXCEEDED, status: 422, message: 'Adding you would exceed the pool’s stop limit.' },
  { code: MatchReason.DETOUR_TOO_HIGH, status: 422, message: 'Adding you would push a passenger beyond the detour limit.' },
];

export class MatchRejectedError extends AppError {
  constructor(readonly decision: MatchDecision) {
    const primary = REJECTION_PRIORITY.find((r) => decision.reasonCodes.includes(r.code as never)) ?? REJECTION_PRIORITY[3];
    super(primary.status, primary.code as ErrorCodeValue, primary.message, {
      requested: decision.capacity.requested,
      available: decision.capacity.available,
      decision,
    });
  }
}

export class PoolService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: AppConfig,
    private readonly distance: DistanceProvider,
  ) {}

  private get ctx(): MatchContext {
    return { rules: this.cfg.pool, weights: this.cfg.scoring, distance: this.distance };
  }

  private joinableStatuses(): PoolStatus[] {
    return this.cfg.pool.allowLateJoin ? ['OPEN', 'MATCHED', 'DRIVER_ARRIVED'] : ['OPEN', 'MATCHED'];
  }

  private asPassenger(ride: RideRequest): PlannedPassenger {
    return { rideRequestId: ride.id, pickupZone: ride.pickupZone as Zone, dropoffZone: ride.dropoffZone as Zone, seats: ride.requestedSeats, flexibility: ride.flexibility };
  }

  /** Attach the fare this passenger would pay on the chosen route (integer poysha). */
  price(decision: MatchDecision, ride: RideRequest): PricedDecision {
    const leg = decision.passengers?.find((p) => p.rideRequestId === ride.id);
    if (decision.decision !== 'MATCHED' || !leg) return decision;
    const fare = pooledFare(ride.quotedFarePoysha, leg.sharedFraction, this.cfg.fare);
    return { ...decision, fare: { ...fare, soloFareBdt: fare.soloFarePoysha / 100, fareBdt: fare.farePoysha / 100 } };
  }

  // ── Pool management ─────────────────────────────────────────────────────────

  async createPool(actor: AuthPrincipal, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw notFound(ErrorCode.VEHICLE_NOT_FOUND, 'Vehicle not found.');
    if (vehicle.driverId !== actor.userId) throw forbidden('You can only open pools with your own vehicle.');
    if (!vehicle.isActive) throw conflict(ErrorCode.VEHICLE_UNAVAILABLE, 'Vehicle is inactive.');
    if (vehicle.capacity > this.cfg.pool.maxCapacity) {
      throw unprocessable(ErrorCode.VEHICLE_CAPACITY_EXCEEDED, `Vehicle capacity ${vehicle.capacity} exceeds POOL_MAX_CAPACITY ${this.cfg.pool.maxCapacity}.`);
    }
    try {
      const pool = await this.prisma.pool.create({ data: { vehicleId, driverId: actor.userId, capacity: vehicle.capacity } });
      logger.info('pool.created', { event: 'POOL_CREATED', poolId: pool.id, vehicleId });
      return pool;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(ErrorCode.ACTIVE_POOL_EXISTS, 'You or this vehicle already have an active pool.');
      throw err;
    }
  }

  async cancelPool(actor: AuthPrincipal, poolId: string) {
    return withTransaction(this.prisma, async (tx) => {
      if (!(await lockPool(tx, poolId))) throw notFound(ErrorCode.POOL_NOT_FOUND, 'Pool not found.');
      const pool = await loadLockedPool(tx, poolId);
      if (pool.driverId !== actor.userId && actor.role !== 'ADMIN') throw forbidden('Only the pool’s driver can cancel it.');
      if (pool.status !== 'OPEN' || activeMembers(pool).length > 0) {
        throw conflict(ErrorCode.POOL_NOT_EMPTY, 'Only an empty OPEN pool can be cancelled; passengers must leave or cancel first.', { status: pool.status });
      }
      return tx.pool.update({ where: { id: poolId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
    });
  }

  // ── Matching ────────────────────────────────────────────────────────────────

  /**
   * Candidate generation + hard constraints + scoring for every joinable pool.
   * ADVISORY ONLY: nothing is locked; the join transaction re-validates everything.
   */
  async evaluateOptions(ride: RideRequest): Promise<PricedDecision[]> {
    const pools = await this.prisma.pool.findMany({
      where: { status: { in: this.joinableStatuses() }, vehicle: { isActive: true, vehicleType: ride.vehicleType } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: this.cfg.pool.candidateLimit,
      include: { memberships: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } }, include: { rideRequest: true } } },
    });
    const request = this.asPassenger(ride);
    const decisions = pools.map((p) => evaluateCandidate(toSnapshot(p as PoolWithMembers), request, this.ctx));
    return rankDecisions(decisions).map((d) => this.price(d, ride));
  }

  /**
   * THE critical section. Lock pool -> lock ride -> re-read everything -> re-run the
   * deterministic engine on fresh state -> write membership, route, fares, occupancy
   * and events -> commit. A candidate that looked feasible a moment ago may be
   * rejected here; the transaction, not the candidate list, is the authority.
   */
  async join(
    actor: AuthPrincipal,
    poolId: string,
    rideId: string,
    opts: { recordRejection?: boolean; initiatedBy?: 'PASSENGER' | 'DRIVER' } = {},
  ): Promise<PricedDecision> {
    const byDriver = opts.initiatedBy === 'DRIVER';
    const started = process.hrtime.bigint();
    counters.matchAttempts++;
    try {
      return await withTransaction(this.prisma, async (tx) => {
        if (!(await lockPool(tx, poolId))) throw notFound(ErrorCode.POOL_NOT_FOUND, 'Pool not found.');
        if (!(await lockRide(tx, rideId))) throw notFound(ErrorCode.RIDE_NOT_FOUND, 'Ride not found.');

        const ride = await tx.rideRequest.findUniqueOrThrow({ where: { id: rideId } });
        if (byDriver) {
          const { driverId } = await tx.pool.findUniqueOrThrow({ where: { id: poolId }, select: { driverId: true } });
          if (driverId !== actor.userId && actor.role !== 'ADMIN') throw forbidden('You can only accept requests into a pool you drive.');
        } else if (ride.passengerId !== actor.userId && actor.role !== 'ADMIN') {
          throw forbidden('You can only match your own ride.');
        }
        if (ride.status !== 'REQUESTED') {
          const current = await tx.poolMembership.findFirst({ where: { rideRequestId: rideId, status: 'ACTIVE' }, select: { poolId: true } });
          if (current?.poolId === poolId) throw conflict(ErrorCode.DUPLICATE_MEMBERSHIP, 'This ride is already a member of this pool.', { poolId });
          throw new InvalidTransition(ride.status, 'MATCHED');
        }

        const pool = await loadLockedPool(tx, poolId);
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: pool.vehicleId }, select: { vehicleType: true, isActive: true } });
        if (!vehicle.isActive) throw conflict(ErrorCode.VEHICLE_UNAVAILABLE, 'The pool’s vehicle is inactive.');
        if (vehicle.vehicleType !== ride.vehicleType) {
          throw unprocessable(ErrorCode.VEHICLE_UNAVAILABLE, `This pool uses ${vehicle.vehicleType}; your ride was quoted for ${ride.vehicleType}.`);
        }

        const decision = evaluateCandidate(toSnapshot(pool), this.asPassenger(ride), this.ctx);
        if (decision.decision === 'REJECTED') throw new MatchRejectedError(decision);

        assertTransition('REQUESTED', 'MATCHED');
        const updatedRide = await tx.rideRequest.update({ where: { id: rideId }, data: { status: 'MATCHED' } });
        const members = [
          ...activeMembers(pool).map((m) => ({ membership: m as typeof m | null, ride: m.rideRequest, seats: m.seats })),
          { membership: null, ride: updatedRide, seats: ride.requestedSeats },
        ];
        // Persist exactly the route the engine chose on this fresh, locked state.
        const coRiderEvents = await persistPlan(tx, this.cfg.fare, {
          pool,
          members,
          plan: { zones: decision.route!, stops: decision.stops!, passengers: decision.passengers!, totalDistanceKm: decision.totalDistanceKm! },
          score: decision.score,
          scoreBreakdown: decision.scoreBreakdown,
          distanceSource: this.distance.source,
          changedRideId: rideId,
          actorId: actor.userId,
          cause: 'JOIN',
        });

        const priced = this.price(decision, updatedRide);
        await appendRideEvents(tx, [
          {
            rideRequestId: rideId,
            poolId,
            eventType: RideEventType.STATUS_CHANGED,
            fromStatus: 'REQUESTED',
            toStatus: 'MATCHED',
            actorId: actor.userId,
            metadata: { cause: byDriver ? 'DRIVER_ACCEPTED' : 'POOL_JOINED', decision: priced },
          },
          ...coRiderEvents,
        ]);
        counters.matchSucceeded++;
        logger.info('pool.matched', { event: 'POOL_MATCHED', poolId, rideRequestId: rideId, route: decision.route, score: decision.score });
        return priced;
      });
    } catch (err) {
      if (err instanceof MatchRejectedError) counters.matchRejected++;
      if (err instanceof MatchRejectedError && opts.recordRejection !== false) {
        await this.recordRejection(actor, rideId, poolId, err.decision);
      }
      if (isUniqueViolation(err, 'pool_memberships_one_active_per_ride')) {
        throw conflict(ErrorCode.DUPLICATE_MEMBERSHIP, 'This ride already has an active pool membership.');
      }
      if (isCapacityGuardViolation(err)) {
        counters.capacityGuardHits++;
        // The database-level guard fired: same meaning, same contract as the engine's rejection.
        logger.error('pool.capacity_guard_triggered', { poolId, rideRequestId: rideId });
        throw conflict(ErrorCode.CAPACITY_EXCEEDED, 'The requested number of seats is not available.', { poolId });
      }
      throw err;
    } finally {
      matchLatency.record(Number(process.hrtime.bigint() - started) / 1e6);
    }
  }

  /**
   * Driver view: waiting (REQUESTED) rides evaluated against THIS pool, feasible first,
   * then by score, then oldest request first (fairness to long-waiting passengers).
   * Advisory: accepting one re-validates everything inside the join transaction.
   */
  async compatibleRequests(actor: AuthPrincipal, poolId: string) {
    const pool = await this.prisma.pool.findUnique({
      where: { id: poolId },
      include: { vehicle: true, memberships: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } }, include: { rideRequest: true } } },
    });
    if (!pool) throw notFound(ErrorCode.POOL_NOT_FOUND, 'Pool not found.');
    if (pool.driverId !== actor.userId && actor.role !== 'ADMIN') throw forbidden('Only the pool’s driver can see its candidate requests.');

    const waiting = await this.prisma.rideRequest.findMany({
      where: { status: 'REQUESTED', vehicleType: pool.vehicle.vehicleType },
      include: { passenger: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: this.cfg.pool.candidateLimit,
    });
    const snapshot = toSnapshot(pool as PoolWithMembers);
    const now = Date.now();
    return waiting
      .map((ride) => ({
        rideRequestId: ride.id,
        passengerFirstName: ride.passenger.name.split(' ')[0],
        pickupZone: ride.pickupZone,
        dropoffZone: ride.dropoffZone,
        requestedSeats: ride.requestedSeats,
        flexibility: ride.flexibility,
        waitingSeconds: Math.max(0, Math.round((now - ride.createdAt.getTime()) / 1000)),
        decision: this.price(evaluateCandidate(snapshot, this.asPassenger(ride), this.ctx), ride),
      }))
      // Feasible first; among those, urgent riders first (urgency already costs them matches, since their
      // tight limit fits fewer pools, so it can't be used to jump the queue for free), then best route, then longest wait.
      .sort(
        (a, b) =>
          Number(b.decision.decision === 'MATCHED') - Number(a.decision.decision === 'MATCHED') ||
          (b.decision.decision === 'MATCHED' ? Number(b.flexibility === 'URGENT') - Number(a.flexibility === 'URGENT') : 0) ||
          (a.decision.score ?? Infinity) - (b.decision.score ?? Infinity) ||
          b.waitingSeconds - a.waitingSeconds,
      );
  }

  private async recordRejection(actor: AuthPrincipal, rideId: string, poolId: string | null, decision: unknown) {
    try {
      await appendRideEvents(this.prisma, [{ rideRequestId: rideId, poolId, eventType: RideEventType.MATCH_REJECTED, actorId: actor.userId, metadata: { decision } }]);
    } catch (err) {
      logger.warn('ride_event.write_failed', { rideRequestId: rideId, error: (err as Error).message });
    }
    logger.info('pool.match_rejected', { event: 'MATCH_REJECTED', poolId, rideRequestId: rideId });
  }

  /** Candidate generation -> hard constraints -> scoring -> transactional join of the best feasible pool. */
  async autoMatch(actor: AuthPrincipal, ride: RideRequest): Promise<AutoMatchResult> {
    if (ride.status !== 'REQUESTED') throw new InvalidTransition(ride.status, 'MATCHED');
    const candidates = await this.evaluateOptions(ride);
    const feasible = candidates.filter((c) => c.decision === 'MATCHED');

    for (const candidate of feasible.slice(0, 3)) {
      try {
        const match = await this.join(actor, candidate.poolId, ride.id, { recordRejection: false });
        return { decision: 'MATCHED', reasonCodes: match.reasonCodes, match, candidatesEvaluated: candidates.length, candidates };
      } catch (err) {
        // Lost a race for this pool (e.g. its last seat): the transaction said no, try the next one.
        if (err instanceof MatchRejectedError || (err instanceof AppError && err.code === ErrorCode.CAPACITY_EXCEEDED)) {
          counters.lostRaces++;
          logger.info('pool.candidate_lost_race', { poolId: candidate.poolId, rideRequestId: ride.id });
          continue;
        }
        throw err;
      }
    }

    const reasonCodes = candidates.length === 0 ? ['NO_POOLS_AVAILABLE'] : [...new Set(candidates.flatMap((c) => c.reasonCodes))];
    await this.recordRejection(actor, ride.id, null, { reasonCodes, candidates: candidates.map((c) => ({ poolId: c.poolId, decision: c.decision, reasonCodes: c.reasonCodes })) });
    return { decision: 'REJECTED', reasonCodes, match: null, candidatesEvaluated: candidates.length, candidates };
  }

  /** Passenger leaves the pool before the driver arrives: ride goes back to REQUESTED and can be matched again. */
  async leave(actor: AuthPrincipal, poolId: string) {
    return withTransaction(this.prisma, async (tx) => {
      const mine = await tx.poolMembership.findFirst({ where: { poolId, passengerId: actor.userId, status: 'ACTIVE' }, select: { rideRequestId: true } });
      if (!mine) throw notFound(ErrorCode.RIDE_NOT_IN_POOL, 'You have no active membership in this pool.');
      const { ride, membership } = await lockRideWithPool(tx, mine.rideRequestId);
      if (!membership || membership.poolId !== poolId) throw notFound(ErrorCode.RIDE_NOT_IN_POOL, 'You have no active membership in this pool.');
      assertTransition(ride.status, 'REQUESTED');

      const updatedRide = await tx.rideRequest.update({ where: { id: ride.id }, data: { status: 'REQUESTED' } });
      await tx.poolMembership.update({ where: { id: membership.id }, data: { status: 'LEFT', endedAt: new Date() } });
      const coRiderEvents = await this.replanWithout(tx, poolId, ride.id, actor.userId, 'LEAVE');
      await appendRideEvents(tx, [
        { rideRequestId: ride.id, poolId, eventType: RideEventType.STATUS_CHANGED, fromStatus: ride.status, toStatus: 'REQUESTED', actorId: actor.userId, metadata: { cause: 'POOL_LEFT' } },
        ...coRiderEvents,
      ]);
      return updatedRide;
    });
  }

  /** Re-plan the remaining passengers after one left/cancelled. Caller holds the pool lock. */
  async replanWithout(tx: Tx, poolId: string, removedRideId: string, actorId: string, cause: 'LEAVE' | 'CANCEL') {
    const pool = await loadLockedPool(tx, poolId);
    const remaining = activeMembers(pool).filter((m) => m.rideRequestId !== removedRideId);
    const passengers = remaining.map((m) => ({ rideRequestId: m.rideRequestId, pickupZone: m.rideRequest.pickupZone as Zone, dropoffZone: m.rideRequest.dropoffZone as Zone, seats: m.seats, flexibility: m.rideRequest.flexibility }));
    // Removing a passenger never lengthens anyone else's ride on a metric graph, so a feasible plan always exists.
    const plan = passengers.length ? bestPlanFor(passengers, this.ctx) : undefined;
    if (passengers.length && !plan) throw new Error(`invariant: no feasible plan after removing a passenger from pool ${poolId}`);
    return persistPlan(tx, this.cfg.fare, {
      pool: { ...pool, memberships: pool.memberships.filter((m) => m.rideRequestId !== removedRideId) },
      members: remaining.map((m) => ({ membership: m, ride: m.rideRequest, seats: m.seats })),
      plan,
      distanceSource: this.distance.source,
      changedRideId: removedRideId,
      actorId,
      cause,
    });
  }

  async getPoolForViewer(actor: AuthPrincipal, poolId: string) {
    const pool = await this.prisma.pool.findUnique({ where: { id: poolId }, include: POOL_VIEW_INCLUDE });
    if (!pool) throw notFound(ErrorCode.POOL_NOT_FOUND, 'Pool not found.');
    const isStaff = actor.role === 'ADMIN' || pool.driverId === actor.userId;
    const isMember = pool.memberships.some((m) => m.passengerId === actor.userId);
    if (!isStaff && !isMember) throw forbidden('Only the pool’s driver and passengers can view it.');
    return { pool, isStaff };
  }

  /** Driver: pools I drive. Passenger: pools I ride in. Admin: all. `active` = not COMPLETED/CANCELLED. */
  async listForViewer(actor: AuthPrincipal, filter: { status?: PoolStatus | 'ACTIVE'; page: number; limit: number }) {
    const scope: Prisma.PoolWhereInput =
      actor.role === 'ADMIN' ? {} : actor.role === 'DRIVER' ? { driverId: actor.userId } : { memberships: { some: { passengerId: actor.userId } } };
    const status: Prisma.PoolWhereInput =
      filter.status === undefined ? {} : filter.status === 'ACTIVE' ? { status: { in: ACTIVE_POOL_STATUSES } } : { status: filter.status };
    const where = { ...scope, ...status };
    const [items, total] = await Promise.all([
      this.prisma.pool.findMany({ where, include: POOL_VIEW_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (filter.page - 1) * filter.limit, take: filter.limit }),
      this.prisma.pool.count({ where }),
    ]);
    return { items: items.map((pool) => ({ pool, isStaff: actor.role === 'ADMIN' || pool.driverId === actor.userId })), total };
  }

  static readonly activeStatuses = ACTIVE_POOL_STATUSES;
}
