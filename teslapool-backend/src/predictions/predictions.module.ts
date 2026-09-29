import { Prisma, type PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { asyncHandler, sendOk } from '../common/http';
import { logger } from '../common/logger';
import { authenticate } from '../common/middleware/auth.middleware';
import type { RateLimiters } from '../common/middleware/rate-limit.middleware';
import { parse } from '../common/validation';
import { errorResponses, jsonBody, jsonResponse, registry, z } from '../docs/openapi-registry';
import { money } from '../fares/fare-engine';
import type { DistanceProvider } from '../geography/distance-provider';
import { DISTANCE_SOURCE } from '../geography/zone-graph';
import { ZoneInput } from '../rides/rides.module';
import { PredictionFeatures, TIMES_OF_DAY, TRAFFIC_LEVELS, VEHICLE_TYPES, WEATHER } from './features';
import type { PredictionResult, PredictionService } from './prediction.service';

/** Explicit model input contract (spec §83). Unknown keys are rejected. */
const PredictionRequest = registry.register(
  'PredictionRequest',
  z
    .object({
      vehicleType: z.enum(VEHICLE_TYPES).openapi({ example: 'AUTO_RICKSHAW' }),
      pickupZone: ZoneInput,
      dropoffZone: ZoneInput.openapi({ example: 'MOHAKHALI' }),
      distanceKm: z.number().gt(0).max(60).optional().openapi({ description: 'What-if override. Omit to use the server-side zone-graph distance.', example: 3.4 }),
      traffic: z.enum(TRAFFIC_LEVELS).openapi({ example: 'HIGH' }),
      weather: z.enum(WEATHER).openapi({ example: 'RAINY' }),
      timeOfDay: z.enum(TIMES_OF_DAY).openapi({ example: 'MORNING_PEAK' }),
      surgeMultiplier: z.number().min(1).max(3).default(1).openapi({ example: 1.3 }),
    })
    .strict()
    .refine((b) => b.pickupZone !== b.dropoffZone, { message: 'pickupZone and dropoffZone must differ', path: ['dropoffZone'] }),
);

const EtaPrediction = registry.register(
  'EtaPrediction',
  z.object({
    predictedDurationMinutes: z.number().openapi({ example: 18 }),
    modelVersion: z.string().openapi({ example: 'eta-v1' }),
    source: z.enum(['ML', 'DETERMINISTIC']),
    reason: z.string().openapi({ example: 'ML_WITHIN_GUARDRAIL' }),
    deterministicMinutes: z.number(),
    mlPredictedMinutes: z.number().nullable(),
    distanceKm: z.number(),
    distanceSource: z.string(),
  }),
);

const FarePrediction = registry.register(
  'FarePrediction',
  z.object({
    predictedFareBdt: z.number().openapi({ example: 137 }),
    predictedFare: z.object({ amountPoysha: z.number().int(), amountBdt: z.number(), currency: z.literal('BDT') }),
    predictedDurationMinutes: z.number(),
    modelVersion: z.string().openapi({ example: 'fare-v1' }),
    fareDecision: z.object({
      baselineFarePoysha: z.number().int(),
      mlPredictedFarePoysha: z.number().int().nullable(),
      guardrailApplied: z.boolean(),
      finalFarePoysha: z.number().int(),
      source: z.enum(['ML', 'DETERMINISTIC']),
      reason: z.enum(['ML_WITHIN_GUARDRAIL', 'FARE_GUARDRAIL_TRIGGERED', 'ML_PREDICTION_UNAVAILABLE']),
      deviationBps: z.number().int().nullable(),
      allowedBand: z.object({ minPoysha: z.number().int(), maxPoysha: z.number().int() }),
      modelVersion: z.string().nullable(),
    }),
    distanceKm: z.number(),
    distanceSource: z.string(),
  }),
);

const sec = [{ bearerAuth: [] }];
registry.registerPath({ method: 'post', path: '/api/v1/predictions/eta', tags: ['Predictions'], security: sec, summary: 'ETA estimate (ML with plausibility guard, deterministic fallback)', request: jsonBody(PredictionRequest), responses: { 200: jsonResponse('ETA', EtaPrediction), ...errorResponses(400, 401, 429) } });
registry.registerPath({ method: 'post', path: '/api/v1/predictions/fare', tags: ['Predictions'], security: sec, summary: 'Solo fare estimate: deterministic baseline + ML signal + guardrail', request: jsonBody(PredictionRequest), responses: { 200: jsonResponse('Fare', FarePrediction), ...errorResponses(400, 401, 429) } });

const eta = (p: PredictionResult) => ({
  predictedDurationMinutes: p.eta.finalMinutes,
  modelVersion: p.eta.source === 'ML' ? p.eta.modelVersion! : 'rules-v1',
  source: p.eta.source,
  reason: p.eta.reason,
  deterministicMinutes: p.eta.deterministicMinutes,
  mlPredictedMinutes: p.eta.mlPredictedMinutes,
  distanceKm: p.features.distanceKm,
  distanceSource: p.distanceSource,
});

export function predictionsRouter(prisma: PrismaClient, predictions: PredictionService, distance: DistanceProvider, limiters: RateLimiters): Router {
  const router = Router();
  router.use(authenticate(prisma), limiters.predictions);

  const run = async (body: unknown) => {
    const req = parse(PredictionRequest, body);
    const features: PredictionFeatures = { ...req, distanceKm: req.distanceKm ?? distance.distanceKm(req.pickupZone, req.dropoffZone) };
    const result = await predictions.predict(features, req.distanceKm === undefined ? distance.source : DISTANCE_SOURCE.CLIENT_SUPPLIED);
    // Prediction log (not tied to a ride). Logging must never fail the prediction itself.
    prisma.predictionEvent
      .createMany({
        data: result.events.map((e) => ({
          modelName: e.modelName, modelVersion: e.modelVersion, predictionType: e.predictionType, predictionValue: e.predictionValue,
          usedForDecision: e.usedForDecision, featureSnapshot: e.featureSnapshot as unknown as Prisma.InputJsonValue,
          metadata: { ...e.metadata, endpoint: true } as Prisma.InputJsonValue, latencyMs: e.latencyMs,
        })),
      })
      .catch((err) => logger.warn('prediction_event.write_failed', { error: (err as Error).message }));
    return result;
  };

  router.post('/eta', asyncHandler(async (req, res) => {
    sendOk(res, eta(await run(req.body)));
  }));

  router.post('/fare', asyncHandler(async (req, res) => {
    const p = await run(req.body);
    sendOk(res, {
      predictedFareBdt: p.fare.finalFarePoysha / 100,
      predictedFare: money(p.fare.finalFarePoysha),
      predictedDurationMinutes: p.eta.finalMinutes,
      modelVersion: p.fare.source === 'ML' ? p.fare.modelVersion! : 'rules-v1',
      fareDecision: p.fare,
      distanceKm: p.features.distanceKm,
      distanceSource: p.distanceSource,
    });
  }));

  return router;
}
