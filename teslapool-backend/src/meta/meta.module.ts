import { Router } from 'express';
import type { AppConfig } from '../config/env';
import { sendOk } from '../common/http';
import { jsonResponse, registry, z } from '../docs/openapi-registry';
import type { DistanceProvider } from '../geography/distance-provider';
import { dhakaZoneGraph } from '../geography/zone-graph';
import { ZONE_INFO, ZONES } from '../geography/zones';
import { POOL_STATUSES } from '../pools/pool-state';
import { TIMES_OF_DAY, TRAFFIC_LEVELS, VEHICLE_MAX_SEATS, VEHICLE_TYPES, WEATHER } from '../predictions/features';
import { allowedTransitions, RIDE_STATUSES } from '../rides/ride-state-machine';

const VEHICLE_LABELS: Record<(typeof VEHICLE_TYPES)[number], string> = {
  AUTO_RICKSHAW: 'Auto-rickshaw ("Tesla", 3 seats)',
  RICKSHAW: 'Rickshaw',
  BIKE_RIDESHARE: 'Bike (ride-share)',
};

const MetaDto = registry.register(
  'Meta',
  z.object({
    zones: z.array(z.object({ code: z.string(), name: z.string(), center: z.object({ lat: z.number(), lng: z.number() }), neighbours: z.array(z.string()) })),
    distanceKm: z.record(z.record(z.number())).openapi({ description: 'Approximate zone-to-zone road distance (ZONE_GRAPH_DISTANCE)' }),
    distanceSource: z.string(),
    vehicleTypes: z.array(z.object({ code: z.string(), name: z.string(), maxSeats: z.number().int() })),
    enums: z.object({
      traffic: z.array(z.string()), weather: z.array(z.string()), timeOfDay: z.array(z.string()),
      rideStatus: z.array(z.string()), poolStatus: z.array(z.string()), roles: z.array(z.string()),
    }),
    rideTransitions: z.record(z.array(z.string())),
    rules: z.object({
      poolMaxCapacity: z.number().int(), pickupMaxHops: z.number().int(), destinationMaxHops: z.number().int(),
      maxDetourKm: z.number(), maxDetourRatio: z.number(), maxStops: z.number().int(), allowLateJoin: z.boolean(),
      detourByFlexibility: z.record(z.enum(['URGENT', 'STANDARD', 'FLEXIBLE']), z.object({ km: z.number(), ratio: z.number() })).openapi({ description: 'Each rider’s own detour limit: max(km, ratio × solo distance)' }),
    }),
    fare: z.object({
      currency: z.literal('BDT'), minorUnit: z.literal('poysha'), minorUnitsPerBdt: z.literal(100),
      basePoysha: z.number().int(), perKmPoysha: z.number().int(), perMinPoysha: z.number().int(),
      maxPoolDiscountPercent: z.number(), mlMaxDeviationPercent: z.number(),
    }),
    ml: z.object({ configured: z.boolean() }),
    auth: z.object({ emailVerification: z.enum(['required', 'optional', 'off']).openapi({ description: 'required: book, drive and top up only after confirming the email code' }), emailProvider: z.enum(['brevo', 'log']) }),
  }),
);

registry.registerPath({
  method: 'get', path: '/api/v1/meta', tags: ['Meta'],
  summary: 'Public reference data for clients: zones (with map centres), vehicle types, enums, ride transitions, business rules. Cacheable.',
  responses: { 200: jsonResponse('Reference data', MetaDto) },
});

/** Everything a client needs to render forms and explanations without hard-coding server vocabulary. */
export function metaRouter(cfg: AppConfig, distance: DistanceProvider): Router {
  const body: z.infer<typeof MetaDto> = {
    zones: ZONES.map((code) => ({ code, name: ZONE_INFO[code].displayName, center: ZONE_INFO[code].center, neighbours: dhakaZoneGraph.neighbours(code) })),
    distanceKm: Object.fromEntries(ZONES.map((a) => [a, Object.fromEntries(ZONES.map((b) => [b, distance.distanceKm(a, b)]))])),
    distanceSource: distance.source,
    vehicleTypes: VEHICLE_TYPES.map((code) => ({ code, name: VEHICLE_LABELS[code], maxSeats: Math.min(VEHICLE_MAX_SEATS[code], cfg.pool.maxCapacity) })),
    enums: {
      traffic: [...TRAFFIC_LEVELS], weather: [...WEATHER], timeOfDay: [...TIMES_OF_DAY],
      rideStatus: [...RIDE_STATUSES], poolStatus: [...POOL_STATUSES], roles: ['PASSENGER', 'DRIVER', 'ADMIN'],
    },
    rideTransitions: Object.fromEntries(RIDE_STATUSES.map((s) => [s, [...allowedTransitions(s)]])),
    rules: {
      poolMaxCapacity: cfg.pool.maxCapacity, pickupMaxHops: cfg.pool.pickupMaxHops, destinationMaxHops: cfg.pool.destinationMaxHops,
      maxDetourKm: cfg.pool.maxDetourKm, maxDetourRatio: cfg.pool.maxDetourRatio, maxStops: cfg.pool.maxStops, allowLateJoin: cfg.pool.allowLateJoin,
      detourByFlexibility: {
        URGENT: cfg.pool.urgentDetour,
        STANDARD: { km: cfg.pool.maxDetourKm, ratio: cfg.pool.maxDetourRatio },
        FLEXIBLE: cfg.pool.flexibleDetour,
      },
    },
    fare: {
      currency: 'BDT', minorUnit: 'poysha', minorUnitsPerBdt: 100,
      basePoysha: cfg.fare.basePoysha, perKmPoysha: cfg.fare.perKmPoysha, perMinPoysha: cfg.fare.perMinPoysha,
      maxPoolDiscountPercent: cfg.fare.maxDiscountBps / 100, mlMaxDeviationPercent: cfg.fare.mlMaxDeviationBps / 100,
    },
    ml: { configured: Boolean(cfg.ml.sidecarUrl) },
    auth: { emailVerification: cfg.email.verification, emailProvider: cfg.email.brevo ? ('brevo' as const) : ('log' as const) },
  };

  const router = Router();
  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    sendOk(res, body);
  });
  return router;
}
