import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { asyncHandler, sendOk } from '../common/http';
import { operationalSnapshot } from '../common/metrics';
import { jsonResponse, registry, z } from '../docs/openapi-registry';
import { money } from '../fares/fare-engine';

/**
 * Impact and integrity KPIs, computed LIVE from the database: nothing here is
 * hard-coded or estimated. Aggregates only; no personal data. `operational` is the
 * in-memory view of this API instance since it started (latency, races, guard hits).
 */

const ratio = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 10_000) / 10_000);

const ImpactDto = registry.register(
  'ImpactStats',
  z.object({
    generatedAt: z.string(),
    rides: z.object({ total: z.number().int(), active: z.number().int(), completed: z.number().int(), cancelled: z.number().int(), cancellationRate: z.number().nullable() }),
    matching: z.object({ ridesMatched: z.number().int(), ridesAttempted: z.number().int(), matchSuccessRate: z.number().nullable(), poolMatches: z.number().int(), rejectedAttempts: z.number().int() }),
    pooling: z.object({
      completedPassengerTrips: z.number().int(), pooledPassengers: z.number().int(), pooledRate: z.number().nullable(),
      totalPassengerSavings: z.record(z.unknown()), averageSavingPerPooledPassenger: z.record(z.unknown()).nullable(),
      averageDiscountPercent: z.number().nullable(), averageDetourKm: z.number().nullable(),
    }),
    occupancy: z.object({ completedPools: z.number().int(), averagePassengersPerPool: z.number().nullable(), averageCapacity: z.number().nullable(), seatUtilization: z.number().nullable() }),
    integrity: z.object({
      capacityViolations: z.number().int(), occupancyCounterDrift: z.number().int(), checkedPools: z.number().int(),
      walletBalanceDrift: z.number().int(), completedRidesWithoutPayment: z.number().int(), paymentAmountMismatches: z.number().int(),
    }),
    payments: z.object({ settled: z.number().int(), cash: z.record(z.unknown()), teslaPay: z.record(z.unknown()) }),
    ml: z.object({ farePredictions: z.number().int(), fareAcceptedByGuardrail: z.number().int(), fareAcceptanceRate: z.number().nullable(), etaPredictions: z.number().int(), etaAccepted: z.number().int() }),
    operational: z.record(z.unknown()),
  }),
);

registry.registerPath({
  method: 'get', path: '/api/v1/stats/impact', tags: ['Stats'],
  summary: 'Impact + integrity dashboard computed live from the database (trips, pooling, savings, occupancy, capacity violations, ML acceptance) plus in-memory operational latency',
  responses: { 200: jsonResponse('KPIs', ImpactDto) },
});

export function statsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/impact', asyncHandler(async (_req, res) => {
    const [rides] = await prisma.$queryRaw<Array<{ total: number; active: number; completed: number; cancelled: number }>>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status IN ('REQUESTED','MATCHED','DRIVER_ARRIVED','STARTED'))::int AS active,
             count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
             count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
        FROM ride_requests`;

    const [matching] = await prisma.$queryRaw<Array<{ matched: number; attempted: number; pool_matches: number; rejected: number }>>`
      SELECT count(DISTINCT ride_request_id) FILTER (WHERE event_type = 'STATUS_CHANGED' AND to_status = 'MATCHED')::int AS matched,
             count(DISTINCT ride_request_id) FILTER (WHERE event_type = 'MATCH_REJECTED' OR (event_type = 'STATUS_CHANGED' AND to_status = 'MATCHED'))::int AS attempted,
             count(*) FILTER (WHERE event_type = 'STATUS_CHANGED' AND to_status = 'MATCHED')::int AS pool_matches,
             count(*) FILTER (WHERE event_type = 'MATCH_REJECTED')::int AS rejected
        FROM ride_events`;

    const [pooling] = await prisma.$queryRaw<Array<{ trips: number; pooled: number; savings: number; avg_saving: number | null; avg_discount: number | null; avg_detour: number | null }>>`
      SELECT count(*)::int AS trips,
             count(*) FILTER (WHERE discount_bps > 0)::int AS pooled,
             COALESCE(sum(solo_fare_poysha - fare_poysha), 0)::int AS savings,
             (avg(solo_fare_poysha - fare_poysha) FILTER (WHERE discount_bps > 0))::float AS avg_saving,
             (avg(discount_bps) FILTER (WHERE discount_bps > 0) / 100.0)::float AS avg_discount,
             avg(detour_km)::float AS avg_detour
        FROM pool_memberships WHERE status = 'COMPLETED'`;

    const [occupancy] = await prisma.$queryRaw<Array<{ pools: number; avg_passengers: number | null; avg_capacity: number | null; seats: number; capacity: number }>>`
      SELECT count(*)::int AS pools, avg(seats)::float AS avg_passengers, avg(capacity)::float AS avg_capacity,
             COALESCE(sum(seats), 0)::int AS seats, COALESCE(sum(capacity), 0)::int AS capacity
        FROM (SELECT p.id, p.capacity, COALESCE(sum(m.seats), 0) AS seats
                FROM pools p LEFT JOIN pool_memberships m ON m.pool_id = p.id AND m.status = 'COMPLETED'
               WHERE p.status = 'COMPLETED' GROUP BY p.id, p.capacity) t`;

    // Integrity: recomputed from raw memberships, not from the counters being checked.
    const [integrity] = await prisma.$queryRaw<Array<{ checked: number; violations: number; drift: number }>>`
      SELECT count(*)::int AS checked,
             count(*) FILTER (WHERE active_seats > capacity)::int AS violations,
             count(*) FILTER (WHERE active_seats <> occupied_seats)::int AS drift
        FROM (SELECT p.capacity, p.occupied_seats, COALESCE(sum(m.seats) FILTER (WHERE m.status = 'ACTIVE'), 0) AS active_seats
                FROM pools p LEFT JOIN pool_memberships m ON m.pool_id = p.id GROUP BY p.id) t`;

    // Money integrity: wallet balances must equal the sum of their ledger; every completed ride has one
    // payment for exactly its final fare.
    const [money_] = await prisma.$queryRaw<Array<{ wallet_drift: number; unpaid: number; mismatched: number; settled: number; cash: number; teslapay: number }>>`
      SELECT
        (SELECT count(*) FROM users u
          WHERE u.wallet_balance_poysha <> COALESCE((SELECT sum(t.amount_poysha) FROM wallet_transactions t WHERE t.user_id = u.id), 0))::int AS wallet_drift,
        (SELECT count(*) FROM ride_requests r WHERE r.status = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_request_id = r.id))::int AS unpaid,
        (SELECT count(*) FROM payments p JOIN ride_requests r ON r.id = p.ride_request_id WHERE p.amount_poysha <> r.final_fare_poysha)::int AS mismatched,
        (SELECT count(*) FROM payments)::int AS settled,
        (SELECT COALESCE(sum(amount_poysha), 0) FROM payments WHERE method = 'CASH')::int AS cash,
        (SELECT COALESCE(sum(amount_poysha), 0) FROM payments WHERE method = 'TESLAPAY')::int AS teslapay`;

    const [ml] = await prisma.$queryRaw<Array<{ fare_total: number; fare_used: number; eta_total: number; eta_used: number }>>`
      SELECT count(*) FILTER (WHERE prediction_type = 'FARE' AND model_version <> 'rules-v1')::int AS fare_total,
             count(*) FILTER (WHERE prediction_type = 'FARE' AND model_version <> 'rules-v1' AND used_for_decision)::int AS fare_used,
             count(*) FILTER (WHERE prediction_type = 'ETA' AND model_version <> 'rules-v1')::int AS eta_total,
             count(*) FILTER (WHERE prediction_type = 'ETA' AND model_version <> 'rules-v1' AND used_for_decision)::int AS eta_used
        FROM prediction_events`;

    sendOk(res, {
      generatedAt: new Date().toISOString(),
      rides: { ...rides, cancellationRate: ratio(rides.cancelled, rides.total) },
      matching: {
        ridesMatched: matching.matched,
        ridesAttempted: matching.attempted,
        matchSuccessRate: ratio(matching.matched, matching.attempted),
        poolMatches: matching.pool_matches,
        rejectedAttempts: matching.rejected,
      },
      pooling: {
        completedPassengerTrips: pooling.trips,
        pooledPassengers: pooling.pooled,
        pooledRate: ratio(pooling.pooled, pooling.trips),
        totalPassengerSavings: money(pooling.savings),
        averageSavingPerPooledPassenger: pooling.avg_saving === null ? null : money(Math.round(pooling.avg_saving)),
        averageDiscountPercent: pooling.avg_discount === null ? null : Math.round(pooling.avg_discount * 100) / 100,
        averageDetourKm: pooling.avg_detour === null ? null : Math.round(pooling.avg_detour * 100) / 100,
      },
      occupancy: {
        completedPools: occupancy.pools,
        averagePassengersPerPool: occupancy.avg_passengers === null ? null : Math.round(occupancy.avg_passengers * 100) / 100,
        averageCapacity: occupancy.avg_capacity === null ? null : Math.round(occupancy.avg_capacity * 100) / 100,
        seatUtilization: ratio(occupancy.seats, occupancy.capacity),
      },
      integrity: {
        capacityViolations: integrity.violations,
        occupancyCounterDrift: integrity.drift,
        checkedPools: integrity.checked,
        walletBalanceDrift: money_.wallet_drift,
        completedRidesWithoutPayment: money_.unpaid,
        paymentAmountMismatches: money_.mismatched,
      },
      payments: { settled: money_.settled, cash: money(money_.cash), teslaPay: money(money_.teslapay) },
      ml: {
        farePredictions: ml.fare_total,
        fareAcceptedByGuardrail: ml.fare_used,
        fareAcceptanceRate: ratio(ml.fare_used, ml.fare_total),
        etaPredictions: ml.eta_total,
        etaAccepted: ml.eta_used,
      },
      operational: operationalSnapshot(),
    });
  }));

  return router;
}
