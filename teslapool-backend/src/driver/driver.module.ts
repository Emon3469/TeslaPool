import type { AppConfig } from '../config/env';
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { AppError, conflict, ErrorCode } from '../common/errors';
import { asyncHandler, sendOk } from '../common/http';
import { authenticate, principal, requireRole, requireVerifiedEmail } from '../common/middleware/auth.middleware';
import { parse } from '../common/validation';
import { errorResponses, jsonBody, jsonResponse, registry, z } from '../docs/openapi-registry';
import { ACTIVE_POOL_STATUSES } from '../pools/pool-state';
import { POOL_VIEW_INCLUDE, PoolService } from '../pools/pools.service';
import { toPoolDto } from '../pools/pools.module';

/**
 * Driver availability, in the PRD's words: "go online / offline".
 * Online is not a separate flag that could drift: a driver is online exactly when they have a
 * live pool (OPEN, MATCHED, DRIVER_ARRIVED or STARTED). Going online opens a pool with the chosen
 * Tesla; going offline cancels it, which is only allowed while nobody is assigned.
 */

const DriverStatusDto = registry.register(
  'DriverStatus',
  z.object({
    online: z.boolean(),
    pool: z.record(z.unknown()).nullable().openapi({ description: 'The live pool (same shape as GET /pools/{id}) or null when offline' }),
    vehicles: z.array(z.object({ id: z.string().uuid(), name: z.string(), vehicleType: z.string(), capacity: z.number().int(), isActive: z.boolean() })),
  }),
);
const OnlineBody = registry.register('GoOnlineRequest', z.object({ vehicleId: z.string().uuid().openapi({ description: 'Which of my Teslas to drive, e.g. Bullet' }) }).strict());

const sec = [{ bearerAuth: [] }];
registry.registerPath({ method: 'get', path: '/api/v1/driver/status', tags: ['Driver'], security: sec, summary: 'Am I online? My live pool (passengers, seats, route) and my vehicles', responses: { 200: jsonResponse('Status', DriverStatusDto), ...errorResponses(401, 403) } });
registry.registerPath({ method: 'post', path: '/api/v1/driver/online', tags: ['Driver'], security: sec, summary: 'Go online with one of my vehicles (opens a pool). Idempotent: already online with that vehicle returns the live pool.', request: jsonBody(OnlineBody), responses: { 200: jsonResponse('Online', DriverStatusDto), ...errorResponses(400, 401, 403, 404, 409, 422) } });
registry.registerPath({ method: 'post', path: '/api/v1/driver/offline', tags: ['Driver'], security: sec, summary: 'Go offline (cancels the empty pool). Refused with DRIVER_HAS_PASSENGERS while anyone is assigned.', responses: { 200: jsonResponse('Offline', DriverStatusDto), ...errorResponses(401, 403, 409) } });

export function driverRouter(prisma: PrismaClient, pools: PoolService, cfg: Pick<AppConfig, 'email'>): Router {
  const router = Router();
  router.use(authenticate(prisma), requireRole('DRIVER'));

  const status = async (driverId: string) => {
    const [pool, vehicles] = await Promise.all([
      prisma.pool.findFirst({ where: { driverId, status: { in: ACTIVE_POOL_STATUSES } }, include: POOL_VIEW_INCLUDE }),
      prisma.vehicle.findMany({ where: { driverId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, vehicleType: true, capacity: true, isActive: true } }),
    ]);
    return { online: pool !== null, pool: pool ? toPoolDto(pool, true, driverId) : null, vehicles };
  };

  router.get('/status', asyncHandler(async (req, res) => {
    sendOk(res, await status(principal(req).userId));
  }));

  router.post('/online', requireVerifiedEmail(cfg.email.verification), asyncHandler(async (req, res) => {
    const { vehicleId } = parse(OnlineBody, req.body);
    const actor = principal(req);
    const live = await prisma.pool.findFirst({ where: { driverId: actor.userId, status: { in: ACTIVE_POOL_STATUSES } }, select: { vehicleId: true } });
    if (live && live.vehicleId !== vehicleId) {
      throw conflict(ErrorCode.ACTIVE_POOL_EXISTS, 'You are already online with another vehicle; go offline first.');
    }
    if (!live) {
      try {
        await pools.createPool(actor, vehicleId);
      } catch (err) {
        // A concurrent "go online" with the same vehicle won the race: that is the state we wanted.
        const now = await prisma.pool.findFirst({ where: { driverId: actor.userId, status: { in: ACTIVE_POOL_STATUSES } }, select: { vehicleId: true } });
        if (!(err instanceof AppError && err.code === ErrorCode.ACTIVE_POOL_EXISTS && now?.vehicleId === vehicleId)) throw err;
      }
    }
    sendOk(res, await status(actor.userId));
  }));

  router.post('/offline', asyncHandler(async (req, res) => {
    const actor = principal(req);
    const live = await prisma.pool.findFirst({ where: { driverId: actor.userId, status: { in: ACTIVE_POOL_STATUSES } }, select: { id: true, status: true, occupiedSeats: true } });
    if (live) {
      if (live.status !== 'OPEN' || live.occupiedSeats > 0) {
        throw conflict(ErrorCode.DRIVER_HAS_PASSENGERS, 'Passengers are assigned to your pool; complete or wait for them to cancel before going offline.', { poolId: live.id, poolStatus: live.status });
      }
      try {
        await pools.cancelPool(actor, live.id);
      } catch (err) {
        // A passenger joined between the check and the locked cancel: same meaning, same code.
        if (err instanceof AppError && err.code === ErrorCode.POOL_NOT_EMPTY) {
          throw conflict(ErrorCode.DRIVER_HAS_PASSENGERS, 'A passenger was just assigned to your pool; you cannot go offline now.', { poolId: live.id });
        }
        throw err;
      }
    }
    sendOk(res, await status(actor.userId));
  }));

  return router;
}
