import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { asyncHandler, pageMeta, sendOk } from '../common/http';
import { authenticate, principal, requireRole, requireVerifiedEmail } from '../common/middleware/auth.middleware';
import { idempotency } from '../common/middleware/idempotency.middleware';
import { parse } from '../common/validation';
import type { AppConfig } from '../config/env';
import { errorResponses, idempotencyHeader, jsonBody, jsonResponse, PaginationQuery, registry, UuidParam, z } from '../docs/openapi-registry';
import { money } from '../fares/fare-engine';
import { ZONE_INFO, ZONES, type Zone } from '../geography/zones';
import { POOL_STATUSES } from './pool-state';
import { PoolService, type PoolView } from './pools.service';

const Money = registry.register(
  'Money',
  z.object({ amountPoysha: z.number().int().openapi({ example: 13000 }), amountBdt: z.number().openapi({ example: 130 }), currency: z.literal('BDT') }),
);

export const MatchDecisionDto = registry.register(
  'MatchDecision',
  z.object({
    decision: z.enum(['MATCHED', 'REJECTED']),
    poolId: z.string().uuid(),
    headline: z.string().openapi({ example: 'Not matched: Only 1 seat left, 2 requested' }),
    reasonCodes: z.array(z.string()).openapi({ example: ['POOL_JOINABLE', 'CAPACITY_AVAILABLE', 'PICKUP_COMPATIBLE', 'DESTINATION_COMPATIBLE', 'STOP_LIMIT_SATISFIED', 'DETOUR_WITHIN_LIMIT'] }),
    checks: z.array(z.object({ rule: z.string(), passed: z.boolean(), code: z.string(), message: z.string().openapi({ example: 'Same pickup zone as current passengers' }), detail: z.record(z.unknown()) })),
    capacity: z.object({ total: z.number().int(), before: z.number().int(), requested: z.number().int(), after: z.number().int(), available: z.number().int() }),
    route: z.array(z.enum(ZONES)).optional().openapi({ example: ['BANANI', 'GULSHAN', 'MOHAKHALI'] }),
    totalDistanceKm: z.number().optional(),
    detourKm: z.number().optional().openapi({ example: 1.1 }),
    score: z.number().optional(),
    scoreBreakdown: z.record(z.number()).optional(),
    passengers: z.array(z.record(z.unknown())).optional(),
    fare: z
      .object({ soloFarePoysha: z.number().int(), farePoysha: z.number().int(), discountBps: z.number().int(), discountPercent: z.number(), sharedFraction: z.number(), soloFareBdt: z.number(), fareBdt: z.number() })
      .optional(),
    alternatives: z.array(z.object({ route: z.array(z.string()), feasible: z.boolean(), violations: z.array(z.string()), totalDistanceKm: z.number(), maxDetourKm: z.number(), stopCount: z.number(), score: z.number().nullable() })),
  }),
);

const PoolDto = registry.register(
  'Pool',
  z.object({
    id: z.string().uuid(),
    status: z.enum(POOL_STATUSES),
    driverId: z.string().uuid(),
    vehicle: z.object({ id: z.string().uuid(), name: z.string().openapi({ example: 'Bullet' }), vehicleType: z.string(), capacity: z.number().int(), registrationNumber: z.string() }),
    capacity: z.number().int(),
    occupiedSeats: z.number().int(),
    availableSeats: z.number().int(),
    route: z.array(z.string()),
    totalDistanceKm: z.number(),
    distanceSource: z.string().nullable(),
    score: z.number().nullable(),
    version: z.number().int(),
    passengers: z.array(
      z.object({
        rideRequestId: z.string().uuid().nullable().openapi({ description: 'Only visible to the driver, admins, and the passenger themself' }),
        firstName: z.string(),
        seats: z.number().int(),
        pickupZone: z.string(),
        dropoffZone: z.string(),
        pickupSequence: z.number().int(),
        dropoffSequence: z.number().int(),
        detourKm: z.number(),
        status: z.string(),
        fare: Money.nullable().openapi({ description: 'Only visible to the driver, admins, and the passenger themself' }),
      }),
    ),
    createdAt: z.string().datetime(),
  }),
);

const CreatePoolBody = registry.register('CreatePoolRequest', z.object({ vehicleId: z.string().uuid() }).strict());
const JoinPoolBody = registry.register('JoinPoolRequest', z.object({ rideRequestId: z.string().uuid() }).strict());

const sec = [{ bearerAuth: [] }];
registry.registerPath({ method: 'post', path: '/api/v1/pools', tags: ['Pools'], summary: 'Driver opens a pool with their vehicle', security: sec, request: jsonBody(CreatePoolBody), responses: { 201: jsonResponse('Pool opened', PoolDto), ...errorResponses(400, 401, 403, 404, 409, 422) } });
registry.registerPath({ method: 'get', path: '/api/v1/pools/{id}', tags: ['Pools'], summary: 'Pool details (driver, admin, or member passenger)', security: sec, request: { params: UuidParam }, responses: { 200: jsonResponse('Pool', PoolDto), ...errorResponses(401, 403, 404) } });
registry.registerPath({
  method: 'post', path: '/api/v1/pools/{id}/join', tags: ['Pools'], security: sec,
  summary: 'Join a specific pool (transactional; re-validates every hard rule under a row lock)',
  description: 'Rejections return the primary reason as error.code (CAPACITY_EXCEEDED, PICKUP_TOO_FAR, …) and the full explainable decision in error.details.decision.',
  request: { params: UuidParam, headers: idempotencyHeader, ...jsonBody(JoinPoolBody) },
  responses: { 200: jsonResponse('Matched, with explanation', MatchDecisionDto), ...errorResponses(400, 401, 403, 404, 409, 422) },
});
registry.registerPath({ method: 'post', path: '/api/v1/pools/{id}/leave', tags: ['Pools'], summary: 'Leave a pool before the driver arrives (ride returns to REQUESTED)', security: sec, request: { params: UuidParam, headers: idempotencyHeader }, responses: { 200: jsonResponse('Left the pool', z.object({ rideRequestId: z.string().uuid(), status: z.string() })), ...errorResponses(401, 404, 409) } });
registry.registerPath({ method: 'post', path: '/api/v1/pools/{id}/cancel', tags: ['Pools'], summary: 'Driver cancels an empty OPEN pool', security: sec, request: { params: UuidParam }, responses: { 200: jsonResponse('Cancelled', PoolDto), ...errorResponses(401, 403, 404, 409) } });

/** Pure mapper. Co-riders only see first names and zones; ride ids and fares only for self, driver and admin. */
export function toPoolDto(pool: PoolView, isStaff: boolean, viewerId: string): z.infer<typeof PoolDto> {
  const routeData = pool.routeData as { distanceSource?: string } | null;
  return {
    id: pool.id,
    status: pool.status,
    driverId: pool.driverId,
    vehicle: { id: pool.vehicle.id, name: pool.vehicle.name, vehicleType: pool.vehicle.vehicleType, capacity: pool.vehicle.capacity, registrationNumber: pool.vehicle.registrationNumber },
    capacity: pool.capacity,
    occupiedSeats: pool.occupiedSeats,
    availableSeats: pool.capacity - pool.occupiedSeats,
    route: pool.plannedStops as Zone[],
    totalDistanceKm: pool.totalDistanceKm,
    distanceSource: routeData?.distanceSource ?? null,
    score: pool.score,
    version: pool.version,
    passengers: pool.memberships.map((m) => {
      const visible = isStaff || m.passengerId === viewerId;
      return {
        rideRequestId: visible ? m.rideRequestId : null,
        firstName: m.passenger.name.split(' ')[0],
        seats: m.seats,
        pickupZone: ZONE_INFO[m.rideRequest.pickupZone as Zone].displayName,
        dropoffZone: ZONE_INFO[m.rideRequest.dropoffZone as Zone].displayName,
        pickupSequence: m.pickupSequence,
        dropoffSequence: m.dropoffSequence,
        detourKm: m.detourKm,
        status: m.rideRequest.status,
        fare: visible ? money(m.farePoysha) : null,
      };
    }),
    createdAt: pool.createdAt.toISOString(),
  };
}

const ListPoolsQuery = PaginationQuery.extend({
  status: z.enum([...POOL_STATUSES, 'ACTIVE']).optional().openapi({ description: 'ACTIVE = OPEN, MATCHED, DRIVER_ARRIVED or STARTED' }),
}).strict();
registry.registerPath({ method: 'get', path: '/api/v1/pools', tags: ['Pools'], summary: 'List pools (driver: pools I drive, passenger: pools I ride in, admin: all). Use ?status=ACTIVE for the current one.', security: sec, request: { query: ListPoolsQuery }, responses: { 200: jsonResponse('Pools, newest first', z.array(PoolDto)), ...errorResponses(400, 401) } });

const CompatibleRequestDto = registry.register(
  'CompatibleRequest',
  z.object({
    rideRequestId: z.string().uuid(),
    passengerFirstName: z.string(),
    pickupZone: z.string(),
    dropoffZone: z.string(),
    requestedSeats: z.number().int(),
    waitingSeconds: z.number().int(),
    decision: MatchDecisionDto,
  }),
);
registry.registerPath({
  method: 'get', path: '/api/v1/pools/{id}/requests', tags: ['Pools'], security: sec,
  summary: 'Driver: waiting ride requests evaluated against this pool, with explanations (feasible first, then score, then longest wait)',
  request: { params: UuidParam },
  responses: { 200: jsonResponse('Candidate requests', z.array(CompatibleRequestDto)), ...errorResponses(401, 403, 404) },
});
registry.registerPath({
  method: 'post', path: '/api/v1/pools/{id}/accept', tags: ['Pools'], security: sec,
  summary: 'Driver accepts a waiting request into their pool (same transactional join and hard rules as a passenger join)',
  request: { params: UuidParam, headers: idempotencyHeader, ...jsonBody(JoinPoolBody) },
  responses: { 200: jsonResponse('Matched, with explanation', MatchDecisionDto), ...errorResponses(400, 401, 403, 404, 409, 422) },
});

export function poolsRouter(prisma: PrismaClient, cfg: AppConfig, pools: PoolService): Router {
  const router = Router();
  router.use(authenticate(prisma));
  const idem = idempotency(prisma, cfg.idempotencyTtlHours);

  const render = async (actor: ReturnType<typeof principal>, poolId: string) => {
    const { pool, isStaff } = await pools.getPoolForViewer(actor, poolId);
    return toPoolDto(pool, isStaff, actor.userId);
  };

  router.get('/', asyncHandler(async (req, res) => {
    const { page, limit, status } = parse(ListPoolsQuery, req.query);
    const actor = principal(req);
    const { items, total } = await pools.listForViewer(actor, { page, limit, status });
    sendOk(res, items.map(({ pool, isStaff }) => toPoolDto(pool, isStaff, actor.userId)), 200, pageMeta({ page, limit, skip: 0 }, total));
  }));

  router.post('/', requireRole('DRIVER'), requireVerifiedEmail(cfg.email.verification), asyncHandler(async (req, res) => {
    const { vehicleId } = parse(CreatePoolBody, req.body);
    const actor = principal(req);
    const pool = await pools.createPool(actor, vehicleId);
    sendOk(res, await render(actor, pool.id), 201);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    sendOk(res, await render(principal(req), id));
  }));

  router.post('/:id/join', requireRole('PASSENGER', 'ADMIN'), idem, asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    const { rideRequestId } = parse(JoinPoolBody, req.body);
    sendOk(res, await pools.join(principal(req), id, rideRequestId));
  }));

  router.get('/:id/requests', requireRole('DRIVER', 'ADMIN'), asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    sendOk(res, await pools.compatibleRequests(principal(req), id));
  }));

  router.post('/:id/accept', requireRole('DRIVER', 'ADMIN'), idem, asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    const { rideRequestId } = parse(JoinPoolBody, req.body);
    sendOk(res, await pools.join(principal(req), id, rideRequestId, { initiatedBy: 'DRIVER' }));
  }));

  router.post('/:id/leave', requireRole('PASSENGER'), idem, asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    const ride = await pools.leave(principal(req), id);
    sendOk(res, { rideRequestId: ride.id, status: ride.status });
  }));

  router.post('/:id/cancel', requireRole('DRIVER', 'ADMIN'), asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    const actor = principal(req);
    await pools.cancelPool(actor, id);
    sendOk(res, await render(actor, id));
  }));

  return router;
}
