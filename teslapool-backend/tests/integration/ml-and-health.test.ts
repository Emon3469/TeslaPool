import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { config } from '../../src/config/env';
import type { MlPredictor, MlRawPrediction } from '../../src/predictions/ml-predictor';
import { MlUnavailableError } from '../../src/predictions/ml-predictor';
import { CONTEXT, makeHarness, registerUser, resetDb } from '../helpers/harness';

function fakeMl(fareBdt: number | 'down', etaMin = 18): MlPredictor & { calls: number } {
  const ml = {
    enabled: true,
    calls: 0,
    async predict(): Promise<MlRawPrediction> {
      ml.calls++;
      if (fareBdt === 'down') throw new MlUnavailableError('sidecar unreachable');
      return { eta: { modelName: 'eta', modelVersion: 'eta-v1', predictedDurationMin: etaMin }, fare: { modelName: 'fare', modelVersion: 'fare-v1', predictedFareBdt: fareBdt }, latencyMs: 2 };
    },
    health: async () => ({ status: fareBdt === 'down' ? ('down' as const) : ('up' as const) }),
  };
  return ml;
}

const ride = (app: Parameters<typeof request>[0], auth: Record<string, string>) =>
  request(app).post('/api/v1/rides').set(auth).send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', context: CONTEXT });

describe('ML is an advisor, never an authority', () => {
  const prisma = new PrismaClient();
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());
  const mlGuarded = { ...config, fare: { ...config.fare, pricingMode: 'ml_guarded' as const } };

  it('default mode: the price is the hand-verifiable formula; the ML estimate is reported and logged, never charged', async () => {
    const app = createApp({ prisma, ml: fakeMl(140) });
    const u = await registerUser(app, 'PASSENGER');
    const res = await ride(app, u.auth);
    expect(res.status).toBe(201);
    // 3.4 km at MEDIUM traffic = 17 min: 5000 + 6800 + 850 = 12650 poysha, whatever the model says.
    expect(res.body.data).toMatchObject({ fareSource: 'DETERMINISTIC', estimatedFare: { amountPoysha: 12650 }, estimatedDurationMinutes: 18 });
    expect(res.body.data.quote.fare).toMatchObject({ pricingMode: 'deterministic', reason: 'DETERMINISTIC_PRICING', mlPredictedFarePoysha: 14000, mlWithinGuardrail: true, modelVersion: 'fare-v1' });
    const logged = await prisma.predictionEvent.findMany({ where: { rideRequestId: res.body.data.rideRequestId, modelVersion: 'fare-v1' } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ predictionValue: 14000, usedForDecision: false });
  });

  it('ml_guarded mode: the ML fare prices the ride when inside the ±20% band, and model + version are logged', async () => {
    const app = createApp({ prisma, ml: fakeMl(140), config: mlGuarded });
    const u = await registerUser(app, 'PASSENGER');
    const res = await ride(app, u.auth);
    expect(res.body.data).toMatchObject({ fareSource: 'ML', estimatedFare: { amountPoysha: 14000 } });
    expect(res.body.data.quote.fare).toMatchObject({ baselineFarePoysha: 12650, reason: 'ML_WITHIN_GUARDRAIL', modelVersion: 'fare-v1' });
    const used = await prisma.predictionEvent.findMany({ where: { rideRequestId: res.body.data.rideRequestId, usedForDecision: true } });
    expect(used.map((e) => `${e.predictionType}:${e.modelVersion}`).sort()).toEqual(['ETA:eta-v1', 'FARE:fare-v1']);
  });

  it('edge case 11 (ml_guarded): an ML fare beyond the guardrail falls back to the deterministic fare', async () => {
    const app = createApp({ prisma, ml: fakeMl(400), config: mlGuarded });
    const u = await registerUser(app, 'PASSENGER');
    const res = await ride(app, u.auth);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ fareSource: 'DETERMINISTIC', estimatedFare: { amountPoysha: 12650 } });
    expect(res.body.data.quote.fare).toMatchObject({ reason: 'FARE_GUARDRAIL_TRIGGERED', guardrailApplied: true, mlPredictedFarePoysha: 40000, mlWithinGuardrail: false });
  });

  it('edge case 12: ML outage -> deterministic ETA and fare, the ride system keeps working (both modes)', async () => {
    for (const cfg of [config, mlGuarded]) {
      await resetDb(prisma);
      const app = createApp({ prisma, ml: fakeMl('down'), config: cfg });
      const u = await registerUser(app, 'PASSENGER');
      const res = await ride(app, u.auth);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ fareSource: 'DETERMINISTIC', estimatedDurationMinutes: 17, estimatedFare: { amountPoysha: 12650 } });
      expect(res.body.data.quote).toMatchObject({ mlAvailable: false, fare: { mlPredictedFarePoysha: null } });
      expect(res.body.data.quote.eta.reason).toBe('ML_PREDICTION_UNAVAILABLE');

      const ready = await request(app).get('/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body).toMatchObject({ status: 'ready_degraded', checks: { database: { status: 'up' }, ml: { status: 'down' } } });
    }
  });

  it('prediction endpoints expose the explicit contract and reject arbitrary features', async () => {
    const app = createApp({ prisma, ml: fakeMl(144), config: mlGuarded });
    const u = await registerUser(app, 'PASSENGER');
    const body = { vehicleType: 'AUTO_RICKSHAW', pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', traffic: 'MEDIUM', weather: 'CLEAR', timeOfDay: 'MORNING_PEAK', surgeMultiplier: 1 };
    const fare = await request(app).post('/api/v1/predictions/fare').set(u.auth).send(body);
    expect(fare.status).toBe(200);
    expect(fare.body.data).toMatchObject({ predictedFareBdt: 144, predictedDurationMinutes: 18, modelVersion: 'fare-v1', distanceKm: 3.4, distanceSource: 'ZONE_GRAPH_DISTANCE' });
    const eta = await request(app).post('/api/v1/predictions/eta').set(u.auth).send(body);
    expect(eta.body.data).toMatchObject({ predictedDurationMinutes: 18, modelVersion: 'eta-v1', source: 'ML' });

    // Default mode: the endpoint answers with the rule price and still shows the model's opinion.
    const det = createApp({ prisma, ml: fakeMl(144) });
    const detFare = await request(det).post('/api/v1/predictions/fare').set(u.auth).send(body);
    expect(detFare.body.data).toMatchObject({ predictedFareBdt: 126.5, modelVersion: 'rules-v1', fareDecision: { mlPredictedFarePoysha: 14400, mlWithinGuardrail: true } });

    const smuggled = await request(app).post('/api/v1/predictions/fare').set(u.auth).send({ ...body, Duration_Minutes: 4 });
    expect(smuggled.status).toBe(400);
    expect((await request(app).post('/api/v1/predictions/fare').send(body)).status).toBe(401);
  });
});

describe('health and database failure injection', () => {
  const h = makeHarness();
  afterAll(() => h.close());

  it('GET /health is a dependency-free liveness probe', async () => {
    const res = await request(h.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready checks the database', async () => {
    const res = await request(h.app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.ml).toMatchObject({ status: 'disabled', fallback: expect.stringContaining('deterministic') });
  });

  it('database unavailable -> readiness 503 and a safe 503 error envelope (no internals leaked)', async () => {
    const dead = new PrismaClient({ datasources: { db: { url: 'postgresql://nobody:nothing@127.0.0.1:1/none?connect_timeout=1' } } });
    const app = createApp({ prisma: dead });
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('not_ready');
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'whatever-123' });
    expect(login.status).toBe(503);
    expect(login.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(login.body)).not.toMatch(/127\.0\.0\.1|postgresql|prisma/i);
    await dead.$disconnect();
  });
});
