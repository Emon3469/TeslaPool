import type { PrismaClient, Vehicle } from '@prisma/client';
import { Router } from 'express';
import type { AppConfig } from '../config/env';
import { isUniqueViolation } from '../common/db';
import { conflict, ErrorCode, forbidden, notFound, unprocessable } from '../common/errors';
import { asyncHandler, pageMeta, sendOk } from '../common/http';
import { authenticate, principal, requireRole } from '../common/middleware/auth.middleware';
import { parse } from '../common/validation';
import { errorResponses, jsonBody, jsonResponse, PaginationQuery, registry, UuidParam, z } from '../docs/openapi-registry';
import { ACTIVE_POOL_STATUSES } from '../pools/pool-state';
import { VEHICLE_MAX_SEATS, VEHICLE_TYPES } from '../predictions/features';

export const VehicleDto = registry.register(
  'Vehicle',
  z.object({
    id: z.string().uuid(),
    driverId: z.string().uuid(),
    name: z.string().openapi({ example: 'Bullet' }),
    vehicleType: z.enum(VEHICLE_TYPES),
    capacity: z.number().int(),
    registrationNumber: z.string(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
  }),
);

const toVehicleDto = (v: Vehicle): z.infer<typeof VehicleDto> => ({
  id: v.id, driverId: v.driverId, name: v.name, vehicleType: v.vehicleType, capacity: v.capacity,
  registrationNumber: v.registrationNumber, isActive: v.isActive, createdAt: v.createdAt.toISOString(),
});

const registration = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9 -]{1,30}[A-Z0-9]$/, 'registrationNumber must be 3-32 characters of letters, digits, spaces or dashes');

const CreateVehicleBody = registry.register(
  'CreateVehicleRequest',
  z
    .object({
      name: z.string().trim().min(1).max(40).openapi({ example: 'Bullet' }),
      vehicleType: z.enum(VEHICLE_TYPES).default('AUTO_RICKSHAW').openapi({ example: 'AUTO_RICKSHAW' }),
      registrationNumber: registration.openapi({ example: 'DHAKA-METRO-TA-11-2233' }),
      capacity: z.number().int().min(1).max(8).optional().openapi({ description: 'Passenger seats; defaults to the vehicle type maximum (Tesla = 3).' }),
    })
    .strict(),
);

const UpdateVehicleBody = registry.register(
  'UpdateVehicleRequest',
  z
    .object({ name: z.string().trim().min(1).max(40).optional(), capacity: z.number().int().min(1).max(8).optional(), isActive: z.boolean().optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
);

registry.registerPath({
  method: 'post', path: '/api/v1/vehicles', tags: ['Vehicles'], summary: 'Register a vehicle (driver only)', security: [{ bearerAuth: [] }],
  request: jsonBody(CreateVehicleBody),
  responses: { 201: jsonResponse('Vehicle created', VehicleDto), ...errorResponses(400, 401, 403, 409, 422) },
});
registry.registerPath({
  method: 'get', path: '/api/v1/vehicles', tags: ['Vehicles'], summary: 'List my vehicles (admins see all)', security: [{ bearerAuth: [] }],
  request: { query: PaginationQuery },
  responses: { 200: jsonResponse('Vehicles', z.array(VehicleDto)), ...errorResponses(401, 403) },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/vehicles/{id}', tags: ['Vehicles'], summary: 'Rename, or update capacity / active flag (owner or admin; capacity and active flag are frozen while in a live pool)', security: [{ bearerAuth: [] }],
  request: { params: UuidParam, ...jsonBody(UpdateVehicleBody) },
  responses: { 200: jsonResponse('Vehicle updated', VehicleDto), ...errorResponses(400, 401, 403, 404, 409, 422) },
});

export function vehiclesRouter(prisma: PrismaClient, cfg: AppConfig): Router {
  const router = Router();
  router.use(authenticate(prisma), requireRole('DRIVER', 'ADMIN'));

  const assertCapacity = (vehicleType: Vehicle['vehicleType'], capacity: number) => {
    const limit = Math.min(VEHICLE_MAX_SEATS[vehicleType], cfg.pool.maxCapacity);
    if (capacity > limit) {
      throw unprocessable(ErrorCode.VEHICLE_CAPACITY_EXCEEDED, `Capacity ${capacity} exceeds the limit of ${limit} for ${vehicleType}.`, {
        requested: capacity, vehicleTypeMax: VEHICLE_MAX_SEATS[vehicleType], poolMaxCapacity: cfg.pool.maxCapacity,
      });
    }
  };

  router.post('/', requireRole('DRIVER'), asyncHandler(async (req, res) => {
    const body = parse(CreateVehicleBody, req.body);
    const capacity = body.capacity ?? Math.min(VEHICLE_MAX_SEATS[body.vehicleType], cfg.pool.maxCapacity);
    assertCapacity(body.vehicleType, capacity);
    try {
      const vehicle = await prisma.vehicle.create({
        data: { driverId: principal(req).userId, name: body.name, vehicleType: body.vehicleType, registrationNumber: body.registrationNumber, capacity },
      });
      sendOk(res, toVehicleDto(vehicle), 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(ErrorCode.REGISTRATION_NUMBER_TAKEN, 'This registration number is already registered.');
      throw err;
    }
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const { page, limit } = parse(PaginationQuery, req.query);
    const who = principal(req);
    const where = who.role === 'ADMIN' ? {} : { driverId: who.userId };
    const [items, total] = await Promise.all([
      prisma.vehicle.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.vehicle.count({ where }),
    ]);
    sendOk(res, items.map(toVehicleDto), 200, pageMeta({ page, limit, skip: 0 }, total));
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(UpdateVehicleBody, req.body);
    const who = principal(req);
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw notFound(ErrorCode.VEHICLE_NOT_FOUND, 'Vehicle not found.');
    if (who.role !== 'ADMIN' && vehicle.driverId !== who.userId) throw forbidden('You can only modify your own vehicles.');
    if (body.capacity !== undefined) assertCapacity(vehicle.vehicleType, body.capacity);

    // Capacity and availability are frozen while the vehicle serves a live pool (renaming is harmless).
    const changesOperation = body.capacity !== undefined || body.isActive !== undefined;
    const livePool = changesOperation
      ? await prisma.pool.findFirst({ where: { vehicleId: id, status: { in: ACTIVE_POOL_STATUSES } }, select: { id: true } })
      : null;
    if (livePool) {
      throw conflict(ErrorCode.VEHICLE_UNAVAILABLE, 'Vehicle is serving an active pool; finish or cancel it first.', { poolId: livePool.id });
    }
    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    sendOk(res, toVehicleDto(updated));
  }));

  return router;
}
