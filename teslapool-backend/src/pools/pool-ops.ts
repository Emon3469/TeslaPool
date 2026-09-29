import { Prisma, type Pool, type PoolMembership, type RideRequest } from '@prisma/client';
import type { FareRates } from '../config/env';
import { lockPool, LockOrderRetry, lockRide, type Tx } from '../common/db';
import { notFound, ErrorCode } from '../common/errors';
import { logger } from '../common/logger';
import { pooledFare } from '../fares/fare-engine';
import { DistanceSource } from '../geography/zone-graph';
import type { Zone } from '../geography/zones';
import { NewRideEvent, RideEventType } from '../ride-events/ride-events';
import type { RideStatus } from '../rides/ride-state-machine';
import type { RoutePlan } from '../route-engine/route-planner';
import type { ScoreBreakdown } from '../route-engine/route-scoring';
import type { PoolSnapshot } from './matching-engine';
import { canPoolTransition, derivePoolStatus } from './pool-state';

/**
 * Transaction-scoped building blocks shared by join / leave / cancel / lifecycle.
 * Every function here expects the pool row to be locked (FOR UPDATE) by the caller.
 * Lock order is always: pool -> ride request. Never the reverse.
 */

export type MemberWithRide = PoolMembership & { rideRequest: RideRequest };
export type PoolWithMembers = Pool & { memberships: MemberWithRide[] };

export async function loadLockedPool(tx: Tx, poolId: string): Promise<PoolWithMembers> {
  const pool = await tx.pool.findUnique({
    where: { id: poolId },
    include: { memberships: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } }, include: { rideRequest: true }, orderBy: { joinedAt: 'asc' } } },
  });
  if (!pool) throw notFound(ErrorCode.POOL_NOT_FOUND, 'Pool not found.');
  return pool;
}

export const activeMembers = (pool: PoolWithMembers) => pool.memberships.filter((m) => m.status === 'ACTIVE');

/** Domain snapshot for the matching engine. Occupancy is RECOMPUTED from memberships, not trusted from the counter. */
export function toSnapshot(pool: PoolWithMembers): PoolSnapshot {
  const active = activeMembers(pool);
  const occupied = active.reduce((a, m) => a + m.seats, 0);
  if (occupied !== pool.occupiedSeats) {
    logger.error('pool.occupancy_drift', { poolId: pool.id, counter: pool.occupiedSeats, recomputed: occupied });
  }
  return {
    id: pool.id,
    status: pool.status,
    capacity: pool.capacity,
    occupiedSeats: occupied,
    members: active.map((m) => ({ rideRequestId: m.rideRequestId, pickupZone: m.rideRequest.pickupZone as Zone, dropoffZone: m.rideRequest.dropoffZone as Zone, seats: m.seats })),
  };
}

/**
 * Lock a ride and (if it has one) its pool, in the correct order. The membership is
 * read without a lock first to learn which pool to lock; if it changed before we got
 * the ride lock, LockOrderRetry re-runs the whole transaction.
 */
export async function lockRideWithPool(tx: Tx, rideId: string): Promise<{ ride: RideRequest; membership: PoolMembership | null }> {
  const before = await tx.poolMembership.findFirst({ where: { rideRequestId: rideId, status: 'ACTIVE' }, select: { poolId: true } });
  if (before) await lockPool(tx, before.poolId);
  if (!(await lockRide(tx, rideId))) throw notFound(ErrorCode.RIDE_NOT_FOUND, 'Ride not found.');
  const membership = await tx.poolMembership.findFirst({ where: { rideRequestId: rideId, status: 'ACTIVE' } });
  if ((membership?.poolId ?? null) !== (before?.poolId ?? null)) throw new LockOrderRetry();
  const ride = await tx.rideRequest.findUniqueOrThrow({ where: { id: rideId } });
  return { ride, membership };
}

export interface PlanMember {
  /** null for the passenger being added in this transaction */
  membership: PoolMembership | null;
  ride: RideRequest;
  seats: number;
}

export interface PersistPlanInput {
  pool: PoolWithMembers;
  members: PlanMember[];
  plan: Pick<RoutePlan, 'zones' | 'stops' | 'passengers' | 'totalDistanceKm'> | undefined;
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  distanceSource: DistanceSource;
  /** Ride whose own event is written by the caller; excluded from ROUTE_UPDATED events. */
  changedRideId: string;
  actorId: string;
  cause: 'JOIN' | 'LEAVE' | 'CANCEL';
}

/**
 * Apply a (re)computed route to the pool: sequences, detours and fares for every
 * active member, occupancy, derived status and version. Fares of riders already
 * STARTED are locked at pickup and never change afterwards.
 */
export async function persistPlan(tx: Tx, rates: FareRates, input: PersistPlanInput): Promise<NewRideEvent[]> {
  const { pool, members, plan } = input;
  const legs = new Map((plan?.passengers ?? []).map((l) => [l.rideRequestId, l]));
  const events: NewRideEvent[] = [];

  for (const m of members) {
    const leg = legs.get(m.ride.id);
    if (!leg) throw new Error(`invariant: plan is missing passenger ${m.ride.id}`);
    const fareLocked = m.membership !== null && (m.ride.status === 'STARTED' || m.ride.status === 'COMPLETED');
    const fare = pooledFare(m.ride.quotedFarePoysha, leg.sharedFraction, rates);
    const data = {
      pickupSequence: leg.pickupSequence,
      dropoffSequence: leg.dropoffSequence,
      detourKm: leg.detourKm,
      sharedFraction: leg.sharedFraction,
      ...(fareLocked ? {} : { soloFarePoysha: fare.soloFarePoysha, discountBps: fare.discountBps, farePoysha: fare.farePoysha }),
    };

    if (m.membership === null) {
      await tx.poolMembership.create({
        data: {
          poolId: pool.id, rideRequestId: m.ride.id, passengerId: m.ride.passengerId, seats: m.seats, ...data,
          soloFarePoysha: fare.soloFarePoysha, discountBps: fare.discountBps, farePoysha: fare.farePoysha,
        },
      });
      continue;
    }
    const prev = m.membership;
    const changed =
      prev.pickupSequence !== data.pickupSequence || prev.dropoffSequence !== data.dropoffSequence ||
      prev.detourKm !== data.detourKm || (!fareLocked && prev.farePoysha !== fare.farePoysha);
    if (!changed) continue;
    await tx.poolMembership.update({ where: { id: prev.id }, data });
    if (m.ride.id !== input.changedRideId) {
      events.push({
        rideRequestId: m.ride.id,
        poolId: pool.id,
        eventType: RideEventType.ROUTE_UPDATED,
        actorId: input.actorId,
        metadata: {
          cause: input.cause,
          route: plan?.zones ?? [],
          detourKm: { before: prev.detourKm, after: leg.detourKm },
          farePoysha: { before: prev.farePoysha, after: fareLocked ? prev.farePoysha : fare.farePoysha },
          fareLocked,
        },
      });
    }
  }

  // Derived pool status from member ride statuses (active + completed memberships).
  const statuses: RideStatus[] = [
    ...members.map((m) => m.ride.status as RideStatus),
    ...pool.memberships.filter((m) => m.status === 'COMPLETED').map((m) => m.rideRequest.status as RideStatus),
  ];
  const nextStatus = derivePoolStatus(pool.status, statuses);
  if (!canPoolTransition(pool.status, nextStatus)) throw new Error(`invariant: pool ${pool.status} -> ${nextStatus}`);

  await tx.pool.update({
    where: { id: pool.id },
    data: {
      // occupied_seats is maintained by the pool_memberships_sync_occupancy trigger (DB-owned counter).
      status: nextStatus,
      plannedStops: (plan?.zones ?? []) as Prisma.InputJsonValue,
      routeData: plan
        ? ({ distanceSource: input.distanceSource, stops: plan.stops, passengers: plan.passengers, scoreBreakdown: input.scoreBreakdown ?? null } as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      totalDistanceKm: plan?.totalDistanceKm ?? 0,
      score: input.score ?? null,
      version: { increment: 1 },
    },
  });
  return events;
}

/** Recompute and store the derived pool status after a member's ride status changed (no route change). */
export async function syncPoolStatus(tx: Tx, poolId: string): Promise<{ from: Pool['status']; to: Pool['status'] }> {
  const pool = await loadLockedPool(tx, poolId);
  const next = derivePoolStatus(pool.status, pool.memberships.map((m) => m.rideRequest.status as RideStatus));
  if (!canPoolTransition(pool.status, next)) throw new Error(`invariant: pool ${pool.status} -> ${next}`);
  if (next !== pool.status) await tx.pool.update({ where: { id: poolId }, data: { status: next, version: { increment: 1 } } });
  return { from: pool.status, to: next };
}
