import type { Payment, PoolMembership, PrismaClient, RideRequest } from '@prisma/client';
import { Router } from 'express';
import { asyncHandler, pageMeta, sendOk } from '../common/http';
import { authenticate, principal, requireRole, requireVerifiedEmail } from '../common/middleware/auth.middleware';
import { idempotency } from '../common/middleware/idempotency.middleware';
import type { RateLimiters } from '../common/middleware/rate-limit.middleware';
import { parse } from '../common/validation';
import { config, type AppConfig } from '../config/env';
import { errorResponses, idempotencyHeader, jsonBody, jsonResponse, PaginationQuery, registry, UuidParam, z } from '../docs/openapi-registry';
import { money } from '../fares/fare-engine';
import { normalizeZone, Zone, ZONE_INFO, ZONES } from '../geography/zones';
import { MatchDecisionDto } from '../pools/pools.module';
import { TIMES_OF_DAY, TRAFFIC_LEVELS, VEHICLE_TYPES, WEATHER } from '../predictions/features';
import type { PredictionResult } from '../predictions/prediction.service';
import { RideEventDto, toRideEventDto } from '../ride-events/ride-events';
import { RIDE_PHASE, RIDE_PHASES, RIDE_STATUSES } from './ride-state-machine';
import { RideExplanationService } from './ride-explanation';
import { RideService } from './rides.service';

// ── Contract ──────────────────────────────────────────────────────────────────

export const ZoneInput = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const zone = normalizeZone(v);
    if (!zone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown zone. Valid: ${ZONES.join(', ')} (aliases like "Gulshan1" accepted)` });
      return z.NEVER;
    }
    return zone;
  })
  .openapi({ type: 'string', enum: [...ZONES], example: 'BANANI' });

// Greater Dhaka bounding box: coordinates outside it are rejected as impossible for this service.
const lat = z.number().min(23.6).max(24.1);
const lng = z.number().min(90.2).max(90.7);

const buildCreateRideBody = (maxSeats: number) =>
  z
    .object({
      pickupZone: ZoneInput,
      dropoffZone: ZoneInput.openapi({ example: 'MOHAKHALI' }),
      pickupLat: lat.optional(),
      pickupLng: lng.optional(),
      dropoffLat: lat.optional(),
      dropoffLng: lng.optional(),
      requestedSeats: z.number().int().min(1).max(maxSeats).default(1),
      vehicleType: z.enum(VEHICLE_TYPES).optional().openapi({ description: 'Vehicle class to quote and match against; defaults to AUTO_RICKSHAW (a "Tesla").' }),
      paymentMethod: z.enum(['CASH', 'TESLAPAY']).default('CASH').openapi({ description: 'CASH (collected by the driver) or TESLAPAY (simulated wallet; balance must cover the quoted solo fare).' }),
      context: z
        .object({ traffic: z.enum(TRAFFIC_LEVELS).optional(), weather: z.enum(WEATHER).optional(), timeOfDay: z.enum(TIMES_OF_DAY).optional() })
        .strict()
        .optional()
        .openapi({ description: 'Observed conditions. Omitted fields are derived server-side (Dhaka clock). Surge is platform-controlled and cannot be set.' }),
    })
    .strict()
    .refine((b) => (b.pickupLat === undefined) === (b.pickupLng === undefined), { message: 'pickupLat and pickupLng must be provided together', path: ['pickupLat'] })
    .refine((b) => (b.dropoffLat === undefined) === (b.dropoffLng === undefined), { message: 'dropoffLat and dropoffLng must be provided together', path: ['dropoffLat'] });

const ListRidesQuery = PaginationQuery.extend({
  status: z.enum([...RIDE_STATUSES, 'ACTIVE']).optional().openapi({ description: 'ACTIVE = REQUESTED, MATCHED, DRIVER_ARRIVED or STARTED (a passenger has at most one)' }),
}).strict();

const CancelBody = z.object({ reason: z.string().trim().max(200).optional() }).strict();

const Money = z.object({ amountPoysha: z.number().int(), amountBdt: z.number(), currency: z.literal('BDT') });

export const RideDto = registry.register(
  'Ride',
  z.object({
    rideRequestId: z.string().uuid(),
    status: z.enum(RIDE_STATUSES),
    phase: z.enum(RIDE_PHASES).openapi({ description: 'PRD tracking vocabulary: WAITING → MATCHED → IN_PROGRESS → COMPLETED / CANCELLED (DRIVER_ARRIVED is still MATCHED)' }),
    pickup: z.object({ zone: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable() }),
    dropoff: z.object({ zone: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable() }),
    requestedSeats: z.number().int(),
    vehicleType: z.string(),
    estimatedDistanceKm: z.number(),
    distanceSource: z.string().openapi({ example: 'ZONE_GRAPH_DISTANCE' }),
    estimatedDurationMinutes: z.number(),
    estimatedFare: Money.openapi({ description: 'Solo fare quote (before pool discount)' }),
    fareSource: z.enum(['ML', 'DETERMINISTIC']),
    fareBreakdown: z
      .object({ base: Money, distanceCharge: Money, timeCharge: Money, total: Money, distanceKm: z.number(), pricingDurationMinutes: z.number(), trafficLevel: z.string() })
      .nullable()
      .openapi({ description: 'Itemised standard fare frozen at request time: base + distance + time = total (hand-verifiable)' }),
    paymentMethod: z.enum(['CASH', 'TESLAPAY']),
    payment: z.object({ method: z.enum(['CASH', 'TESLAPAY']), amount: Money, settledAt: z.string().datetime() }).nullable(),
    pool: z
      .object({ poolId: z.string().uuid(), membershipStatus: z.string(), fare: Money, soloFare: Money, discountPercent: z.number(), pickupSequence: z.number().int(), dropoffSequence: z.number().int(), detourKm: z.number() })
      .nullable(),
    finalFare: Money.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

const RideQuote = registry.register(
  'RideQuote',
  z.object({
    mlAvailable: z.boolean(),
    conditions: z.record(z.unknown()),
    eta: z.record(z.unknown()).openapi({ description: 'EtaDecision: finalMinutes, deterministicMinutes, mlPredictedMinutes, source, reason, modelVersion' }),
    fare: z.record(z.unknown()).openapi({ description: 'FareDecision: baselineFarePoysha, mlPredictedFarePoysha, guardrailApplied, finalFarePoysha, source, reason, deviationBps, allowedBand, modelVersion' }),
  }),
);

const CreateRideResponse = RideDto.extend({ quote: RideQuote, poolOptions: z.array(MatchDecisionDto) });
const AutoMatchResponse = registry.register(
  'AutoMatchResult',
  z.object({ decision: z.enum(['MATCHED', 'REJECTED']), reasonCodes: z.array(z.string()), match: MatchDecisionDto.nullable(), candidatesEvaluated: z.number().int(), candidates: z.array(MatchDecisionDto) }),
);

// ── DTO mapping ───────────────────────────────────────────────────────────────

type RideWithMemberships = RideRequest & { memberships: PoolMembership[]; payment?: Payment | null };

export function toRideDto(ride: RideWithMemberships): z.infer<typeof RideDto> {
  const m = ride.memberships.find((x) => x.status === 'ACTIVE' || x.status === 'COMPLETED') ?? null;
  const place = (zone: string, la: number | null, ln: number | null) => ({ zone, name: ZONE_INFO[zone as Zone].displayName, lat: la, lng: ln });
  return {
    rideRequestId: ride.id,
    status: ride.status,
    phase: RIDE_PHASE[ride.status],
    pickup: place(ride.pickupZone, ride.pickupLat, ride.pickupLng),
    dropoff: place(ride.dropoffZone, ride.dropoffLat, ride.dropoffLng),
    requestedSeats: ride.requestedSeats,
    vehicleType: ride.vehicleType,
    estimatedDistanceKm: ride.estimatedDistanceKm,
    distanceSource: ride.distanceSource,
    estimatedDurationMinutes: ride.estimatedDurationMin,
    estimatedFare: money(ride.quotedFarePoysha),
    fareSource: ride.fareSource as 'ML' | 'DETERMINISTIC',
    fareBreakdown:
      ride.baseFarePoysha === null || ride.distanceChargePoysha === null || ride.timeChargePoysha === null
        ? null
        : {
            base: money(ride.baseFarePoysha),
            distanceCharge: money(ride.distanceChargePoysha),
            timeCharge: money(ride.timeChargePoysha),
            total: money(ride.baseFarePoysha + ride.distanceChargePoysha + ride.timeChargePoysha),
            distanceKm: ride.estimatedDistanceKm,
            pricingDurationMinutes: ride.pricingDurationMin ?? ride.estimatedDurationMin,
            trafficLevel: ride.trafficLevel ?? 'UNKNOWN',
          },
    paymentMethod: ride.paymentMethod,
    payment: ride.payment ? { method: ride.payment.method, amount: money(ride.payment.amountPoysha), settledAt: ride.payment.settledAt.toISOString() } : null,
    pool: m && {
      poolId: m.poolId,
      membershipStatus: m.status,
      fare: money(m.farePoysha),
      soloFare: money(m.soloFarePoysha),
      discountPercent: m.discountBps / 100,
      pickupSequence: m.pickupSequence,
      dropoffSequence: m.dropoffSequence,
      detourKm: m.detourKm,
    },
    finalFare: ride.finalFarePoysha === null ? null : money(ride.finalFarePoysha),
    createdAt: ride.createdAt.toISOString(),
    updatedAt: ride.updatedAt.toISOString(),
  };
}

const toQuote = (p: PredictionResult) => ({
  mlAvailable: p.mlAvailable,
  conditions: { ...p.features, distanceSource: p.distanceSource },
  eta: p.eta,
  fare: p.fare,
});

// ── Routes ────────────────────────────────────────────────────────────────────

const CreateRideBody = registry.register('CreateRideRequest', buildCreateRideBody(config.pool.maxCapacity));

const sec = [{ bearerAuth: [] }];
const lifecycle = [
  ['arrive', 'DRIVER_ARRIVED', 'Driver arrived at pickup (MATCHED → DRIVER_ARRIVED)'],
  ['start', 'STARTED', 'Passenger picked up (DRIVER_ARRIVED → STARTED); fare locks'],
  ['complete', 'COMPLETED', 'Passenger dropped off (STARTED → COMPLETED); final fare recorded'],
] as const;
registry.registerPath({
  method: 'post', path: '/api/v1/rides', tags: ['Rides'], security: sec,
  summary: 'Request a ride: server-side distance, ML-assisted ETA/fare with guardrails, explainable pool options',
  request: { headers: idempotencyHeader, ...jsonBody(CreateRideBody) },
  responses: { 201: jsonResponse('Ride requested', CreateRideResponse), ...errorResponses(400, 401, 403, 409, 429) },
});
registry.registerPath({ method: 'get', path: '/api/v1/rides', tags: ['Rides'], security: sec, summary: 'List rides (passenger: own; driver: rides in own pools; admin: all). ?status=ACTIVE returns the current ride.', request: { query: ListRidesQuery }, responses: { 200: jsonResponse('Rides', z.array(RideDto)), ...errorResponses(400, 401) } });
registry.registerPath({ method: 'get', path: '/api/v1/rides/{id}', tags: ['Rides'], security: sec, summary: 'Ride details', request: { params: UuidParam }, responses: { 200: jsonResponse('Ride', RideDto), ...errorResponses(401, 403, 404) } });
registry.registerPath({ method: 'get', path: '/api/v1/rides/{id}/events', tags: ['Rides'], security: sec, summary: 'Immutable event history of a ride', request: { params: UuidParam }, responses: { 200: jsonResponse('Events, oldest first', z.array(RideEventDto)), ...errorResponses(401, 403, 404) } });
registry.registerPath({
  method: 'post', path: '/api/v1/rides/{id}/match', tags: ['Rides'], security: sec,
  summary: 'Auto-match: evaluate all candidate pools, then join the best feasible one transactionally',
  description: 'Returns 200 with decision REJECTED (and per-pool reason codes) when no pool is feasible; the ride stays REQUESTED.',
  request: { params: UuidParam, headers: idempotencyHeader },
  responses: { 200: jsonResponse('Match outcome with explanation', AutoMatchResponse), ...errorResponses(401, 403, 404, 409) },
});
registry.registerPath({ method: 'post', path: '/api/v1/rides/{id}/cancel', tags: ['Rides'], security: sec, summary: 'Cancel (from REQUESTED, MATCHED or DRIVER_ARRIVED only)', request: { params: UuidParam, headers: idempotencyHeader, ...jsonBody(CancelBody) }, responses: { 200: jsonResponse('Cancelled', RideDto), ...errorResponses(401, 403, 404, 409) } });
for (const [action, , summary] of lifecycle) {
  registry.registerPath({ method: 'post', path: `/api/v1/rides/{id}/${action}`, tags: ['Driver lifecycle'], security: sec, summary: `${summary}. Driver of the ride's pool only.`, request: { params: UuidParam }, responses: { 200: jsonResponse('Updated ride', RideDto), ...errorResponses(401, 403, 404, 409) } });
}

const RideExplanationDto = registry.register(
  'RideExplanation',
  z.object({
    rideRequestId: z.string().uuid(),
    status: z.string(),
    summary: z.array(z.string()).openapi({ example: ['Sharing with Rafiq', 'Route: Banani → Gulshan 1 → Mohakhali', 'You share 55.6% of your ride, so you get a 13.89% pool discount: you pay ৳109.49 instead of ৳127.15 (save ৳17.66).'] }),
    match: z.object({ headline: z.string(), matchedAt: z.string(), initiatedBy: z.enum(['PASSENGER', 'DRIVER']), reasons: z.array(z.object({ rule: z.string(), passed: z.boolean(), message: z.string() })), routeAtMatch: z.array(z.string()), detourKmAtMatch: z.number() }).nullable(),
    trip: z.record(z.unknown()).nullable().openapi({ description: 'poolId, poolStatus, driverFirstName, vehicle, route, yourPickup/yourDropoff (stop numbers), yourDetourKm, coPassengers (first names only)' }),
    fare: z.record(z.unknown()).openapi({ description: 'standard (base + distance + time, itemised), quote (ML/guardrail decision), pooled (solo vs pooled, saving, shared %, discount %), final, lines (plain language)' }),
    rejections: z.array(z.object({ at: z.string(), poolId: z.string().nullable(), headline: z.string(), reasons: z.array(z.string()), reasonCodes: z.array(z.string()) })),
    timeline: z.array(z.object({ at: z.string(), eventType: z.string(), from: z.string().nullable(), to: z.string().nullable(), description: z.string() })),
  }),
);
registry.registerPath({
  method: 'get', path: '/api/v1/rides/{id}/explanation', tags: ['Rides'], security: sec,
  summary: 'Explain this ride in plain language: why matched (or not), why this price, and what happened',
  request: { params: UuidParam },
  responses: { 200: jsonResponse('Explanation', RideExplanationDto), ...errorResponses(401, 403, 404) },
});

export function ridesRouter(prisma: PrismaClient, cfg: AppConfig, rides: RideService, limiters: RateLimiters, explanations: RideExplanationService): Router {
  const router = Router();
  router.use(authenticate(prisma));
  const idem = idempotency(prisma, cfg.idempotencyTtlHours);
  const withMemberships = (id: string) => prisma.rideRequest.findUniqueOrThrow({ where: { id }, include: { payment: true, memberships: { orderBy: { joinedAt: 'desc' } } } });

  router.post('/', requireRole('PASSENGER'), requireVerifiedEmail(cfg.email.verification), limiters.rides, idem, asyncHandler(async (req, res) => {
    const body = parse(CreateRideBody, req.body);
    const { ride, prediction, poolOptions } = await rides.create(principal(req), body);
    sendOk(res, { ...toRideDto({ ...ride, memberships: [] }), quote: toQuote(prediction), poolOptions }, 201);
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const { page, limit, status } = parse(ListRidesQuery, req.query);
    const { items, total } = await rides.list(principal(req), page, limit, status);
    sendOk(res, items.map(toRideDto), 200, pageMeta({ page, limit, skip: 0 }, total));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    sendOk(res, toRideDto(await rides.getVisible(principal(req), id)));
  }));

  router.get('/:id/events', asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    sendOk(res, (await rides.events(principal(req), id)).map(toRideEventDto));
  }));

  router.get('/:id/explanation', asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    sendOk(res, await explanations.explain(principal(req), id));
  }));

  router.post('/:id/match', requireRole('PASSENGER', 'ADMIN'), limiters.rides, idem, asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    sendOk(res, await rides.match(principal(req), id));
  }));

  router.post('/:id/cancel', requireRole('PASSENGER', 'ADMIN'), idem, asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    const { reason } = parse(CancelBody, req.body ?? {});
    await rides.cancel(principal(req), id, reason);
    sendOk(res, toRideDto(await withMemberships(id)));
  }));

  for (const [action, target] of lifecycle) {
    router.post(`/:id/${action}`, requireRole('DRIVER', 'ADMIN'), asyncHandler(async (req, res) => {
      const { id } = parse(UuidParam, req.params);
      await rides.advance(principal(req), id, target);
      sendOk(res, toRideDto(await withMemberships(id)));
    }));
  }

  return router;
}
