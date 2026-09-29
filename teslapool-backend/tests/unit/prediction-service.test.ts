import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PredictionFeatures } from '../../src/predictions/features';
import { toModelSnapshot } from '../../src/predictions/features';
import { DisabledMlPredictor, HttpMlPredictor, MlPredictor, MlRawPrediction, MlUnavailableError } from '../../src/predictions/ml-predictor';
import { PredictionService } from '../../src/predictions/prediction.service';

const etaRules = { minPerKm: { LOW: 3.3, MEDIUM: 5, HIGH: 7.5, GRIDLOCK: 12 }, mlMinRatio: 0.5, mlMaxRatio: 2 };
const rates = { basePoysha: 5000, perKmPoysha: 2000, perMinPoysha: 50, poolAlphaBps: 2500, maxDiscountBps: 2500, mlMaxDeviationBps: 2000, pricingMode: 'ml_guarded' as const };
const deterministic = { ...rates, pricingMode: 'deterministic' as const };
const features: PredictionFeatures = {
  vehicleType: 'AUTO_RICKSHAW', pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', distanceKm: 3.4,
  traffic: 'MEDIUM', weather: 'CLEAR', timeOfDay: 'MORNING_PEAK', surgeMultiplier: 1,
};

const fakeMl = (etaMin: number, fareBdt: number): MlPredictor => ({
  enabled: true,
  predict: async (): Promise<MlRawPrediction> => ({
    eta: { modelName: 'eta', modelVersion: 'eta-v1', predictedDurationMin: etaMin },
    fare: { modelName: 'fare', modelVersion: 'fare-v1', predictedFareBdt: fareBdt },
    latencyMs: 3,
  }),
  health: async () => ({ status: 'up' as const }),
});

describe('PredictionService: ML predicts, guardrails validate, deterministic fallback', () => {
  it('uses ML ETA and ML fare when both are inside their guardrails', async () => {
    const r = await new PredictionService(fakeMl(18, 140), etaRules, rates).predict(features, 'ZONE_GRAPH_DISTANCE');
    expect(r.mlAvailable).toBe(true);
    expect(r.eta).toMatchObject({ finalMinutes: 18, deterministicMinutes: 17, source: 'ML', modelVersion: 'eta-v1' });
    // The fare is priced on the DETERMINISTIC 17 min (hand-verifiable): 5000 + 6800 + 850 = 12650; ML 14000 is +10.7% -> accepted
    expect(r.fare).toMatchObject({ baselineFarePoysha: 12650, mlPredictedFarePoysha: 14000, finalFarePoysha: 14000, source: 'ML' });
    expect(r.fareBreakdown).toEqual({ basePoysha: 5000, distanceChargePoysha: 6800, timeChargePoysha: 850, totalPoysha: 12650, pricingDurationMin: 17, traffic: 'MEDIUM' });
  });

  it('falls back to the deterministic fare when ML exceeds the guardrail', async () => {
    const r = await new PredictionService(fakeMl(18, 240), etaRules, rates).predict(features, 'ZONE_GRAPH_DISTANCE');
    expect(r.fare).toMatchObject({ finalFarePoysha: 12650, source: 'DETERMINISTIC', reason: 'FARE_GUARDRAIL_TRIGGERED', guardrailApplied: true });
  });

  it('default pricing mode charges the hand-verifiable baseline even when a plausible ML fare exists', async () => {
    const r = await new PredictionService(fakeMl(18, 140), etaRules, deterministic).predict(features, 'ZONE_GRAPH_DISTANCE');
    expect(r.eta).toMatchObject({ finalMinutes: 18, source: 'ML' }); // riders see the better ETA...
    expect(r.fare).toMatchObject({ finalFarePoysha: 12650, source: 'DETERMINISTIC', reason: 'DETERMINISTIC_PRICING', mlPredictedFarePoysha: 14000, mlWithinGuardrail: true });
  });

  it('rejects an implausible ML ETA and uses the deterministic one', async () => {
    const r = await new PredictionService(fakeMl(240, 140), etaRules, rates).predict(features, 'ZONE_GRAPH_DISTANCE');
    expect(r.eta).toMatchObject({ finalMinutes: 17, source: 'DETERMINISTIC', reason: 'ETA_GUARDRAIL_TRIGGERED' });
  });

  it('keeps working when the model is unavailable (graceful degradation)', async () => {
    const broken: MlPredictor = { enabled: true, predict: async () => { throw new MlUnavailableError('boom'); }, health: async () => ({ status: 'down' as const }) };
    const r = await new PredictionService(broken, etaRules, rates).predict(features, 'ZONE_GRAPH_DISTANCE');
    expect(r.mlAvailable).toBe(false);
    expect(r.eta).toMatchObject({ finalMinutes: 17, source: 'DETERMINISTIC', reason: 'ML_PREDICTION_UNAVAILABLE' });
    expect(r.fare).toMatchObject({ finalFarePoysha: 5000 + 6800 + 850, source: 'DETERMINISTIC', reason: 'ML_PREDICTION_UNAVAILABLE' });
  });

  it('works with ML disabled entirely', async () => {
    const r = await new PredictionService(new DisabledMlPredictor(), etaRules, rates).predict(features, 'ZONE_GRAPH_DISTANCE');
    expect(r.fare.source).toBe('DETERMINISTIC');
  });

  it('records which model/version produced each prediction and the exact features it saw', async () => {
    const r = await new PredictionService(fakeMl(18, 140), etaRules, rates).predict(features, 'ZONE_GRAPH_DISTANCE');
    expect(r.events.map((e) => `${e.predictionType}:${e.modelName}@${e.modelVersion}:${e.usedForDecision}`)).toEqual([
      'ETA:deterministic-eta@rules-v1:false',
      'FARE:deterministic-fare@rules-v1:false',
      'ETA:eta@eta-v1:true',
      'FARE:fare@fare-v1:true',
    ]);
    expect(r.events[2].featureSnapshot).toEqual(toModelSnapshot(features));
    expect(r.events[2].featureSnapshot).not.toHaveProperty('Duration_Minutes'); // no leakage of actual duration
    expect(toModelSnapshot(features)).toMatchObject({ Vehicle_Type: 'CNG Auto-Rickshaw', Pickup_Zone: 'Banani', Time_of_Day: 'Morning Peak' });
  });
});

describe('HttpMlPredictor (sidecar client)', () => {
  let server: http.Server;
  let mode: 'ok' | 'slow' | 'garbage' | '500' = 'ok';
  let calls = 0;
  let url = '';

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      calls++;
      if (mode === 'slow') return void setTimeout(() => res.end('{}'), 500);
      if (mode === '500') return void res.writeHead(500).end();
      res.setHeader('content-type', 'application/json');
      if (mode === 'garbage') return void res.end(JSON.stringify({ eta: { predictedDurationMin: 'soon' } }));
      res.end(JSON.stringify({ eta: { modelName: 'eta', modelVersion: 'eta-v1', predictedDurationMin: 18 }, fare: { modelName: 'fare', modelVersion: 'fare-v1', predictedFareBdt: 144 } }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    calls = 0;
    mode = 'ok';
  });

  it('returns validated predictions', async () => {
    const r = await new HttpMlPredictor(url, 300, 1000).predict(toModelSnapshot(features));
    expect(r.fare.predictedFareBdt).toBe(144);
  });

  it.each(['slow', 'garbage', '500'] as const)('treats a %s response as unavailable', async (m) => {
    mode = m;
    await expect(new HttpMlPredictor(url, 100, 1000).predict(toModelSnapshot(features))).rejects.toBeInstanceOf(MlUnavailableError);
  });

  it('opens a circuit after a failure so an outage costs one timeout, not one per request', async () => {
    let now = 0;
    const client = new HttpMlPredictor(url, 100, 30_000, () => now);
    mode = '500';
    await expect(client.predict(toModelSnapshot(features))).rejects.toBeInstanceOf(MlUnavailableError);
    mode = 'ok';
    await expect(client.predict(toModelSnapshot(features))).rejects.toThrow(/circuit open/);
    expect(calls).toBe(1);
    now = 31_000;
    await expect(client.predict(toModelSnapshot(features))).resolves.toBeDefined();
  });
});
