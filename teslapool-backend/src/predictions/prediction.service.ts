import type { EtaRules, FareRates } from '../config/env';
import { applyFareGuardrail, FareDecision, SoloFareBreakdown, soloFareBreakdown } from '../fares/fare-engine';
import { DistanceSource } from '../geography/zone-graph';
import { ModelFeatureSnapshot, PredictionFeatures, toModelSnapshot } from './features';
import { MlPredictor, MlRawPrediction } from './ml-predictor';

/**
 * ML predicts -> guardrails validate -> deterministic fallback always available.
 *
 *  1. Deterministic ETA = distance x minutes-per-km(traffic).
 *  2. Ask the ML sidecar (outside any DB transaction). Failure is not an error.
 *  3. ETA guardrail: accept the ML ETA only within [minRatio, maxRatio] x deterministic ETA.
 *  4. Deterministic fare baseline from distance and the DETERMINISTIC duration (so the price can be
 *     reproduced by hand from distance + traffic level; the ETA shown to riders may still be ML).
 *  5. Pricing: deterministic by default; with FARE_PRICING_MODE=ml_guarded the ML fare may set the
 *     price only inside +/- ML_FARE_MAX_DEVIATION of the baseline.
 */

export const DETERMINISTIC_ETA_MODEL = { name: 'deterministic-eta', version: 'rules-v1' };
export const DETERMINISTIC_FARE_MODEL = { name: 'deterministic-fare', version: 'rules-v1' };

export type EtaReason = 'ML_WITHIN_GUARDRAIL' | 'ETA_GUARDRAIL_TRIGGERED' | 'ML_PREDICTION_UNAVAILABLE';

export interface EtaDecision {
  finalMinutes: number;
  deterministicMinutes: number;
  mlPredictedMinutes: number | null;
  source: 'ML' | 'DETERMINISTIC';
  reason: EtaReason;
  modelVersion: string | null;
}

/** Row shape for the immutable prediction_events table. */
export interface PredictionEventRecord {
  modelName: string;
  modelVersion: string;
  predictionType: 'ETA' | 'FARE';
  predictionValue: number;
  usedForDecision: boolean;
  featureSnapshot: ModelFeatureSnapshot & { predicted_duration_min?: number };
  metadata: Record<string, unknown>;
  latencyMs: number | null;
}

export interface PredictionResult {
  features: PredictionFeatures;
  distanceSource: DistanceSource;
  mlAvailable: boolean;
  eta: EtaDecision;
  fare: FareDecision;
  /** Itemised deterministic solo fare and the duration it was priced on. */
  fareBreakdown: SoloFareBreakdown & { pricingDurationMin: number; traffic: PredictionFeatures['traffic'] };
  events: PredictionEventRecord[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function deterministicEtaMinutes(distanceKm: number, traffic: PredictionFeatures['traffic'], rules: EtaRules): number {
  return Math.max(1, round1(distanceKm * rules.minPerKm[traffic]));
}

export class PredictionService {
  constructor(
    private readonly ml: MlPredictor,
    private readonly etaRules: EtaRules,
    private readonly fareRates: FareRates,
  ) {}

  async predict(features: PredictionFeatures, distanceSource: DistanceSource): Promise<PredictionResult> {
    const snapshot = toModelSnapshot(features);
    let raw: MlRawPrediction | null = null;
    let mlError: string | null = null;
    if (this.ml.enabled) {
      try {
        raw = await this.ml.predict(snapshot);
      } catch (err) {
        mlError = (err as Error).message;
      }
    } else {
      mlError = 'ML sidecar not configured';
    }

    // ETA
    const detEta = deterministicEtaMinutes(features.distanceKm, features.traffic, this.etaRules);
    let eta: EtaDecision;
    if (!raw) {
      eta = { finalMinutes: detEta, deterministicMinutes: detEta, mlPredictedMinutes: null, source: 'DETERMINISTIC', reason: 'ML_PREDICTION_UNAVAILABLE', modelVersion: null };
    } else {
      const ml = round1(raw.eta.predictedDurationMin);
      const plausible = ml >= detEta * this.etaRules.mlMinRatio && ml <= detEta * this.etaRules.mlMaxRatio;
      eta = {
        finalMinutes: plausible ? Math.max(1, ml) : detEta,
        deterministicMinutes: detEta,
        mlPredictedMinutes: ml,
        source: plausible ? 'ML' : 'DETERMINISTIC',
        reason: plausible ? 'ML_WITHIN_GUARDRAIL' : 'ETA_GUARDRAIL_TRIGGERED',
        modelVersion: raw.eta.modelVersion,
      };
    }

    // Fare: priced on the deterministic duration (hand-verifiable); ML fare converted to integer poysha once.
    const breakdown = soloFareBreakdown(features.distanceKm, detEta, this.fareRates);
    const baseline = breakdown.totalPoysha;
    const mlFarePoysha = raw ? Math.round(raw.fare.predictedFareBdt * 100) : null;
    const fare = applyFareGuardrail(baseline, mlFarePoysha, raw?.fare.modelVersion ?? null, this.fareRates);

    const events: PredictionEventRecord[] = [
      {
        modelName: DETERMINISTIC_ETA_MODEL.name,
        modelVersion: DETERMINISTIC_ETA_MODEL.version,
        predictionType: 'ETA',
        predictionValue: detEta,
        usedForDecision: eta.source === 'DETERMINISTIC',
        featureSnapshot: snapshot,
        metadata: { unit: 'minutes', reason: eta.reason, mlError },
        latencyMs: null,
      },
      {
        modelName: DETERMINISTIC_FARE_MODEL.name,
        modelVersion: DETERMINISTIC_FARE_MODEL.version,
        predictionType: 'FARE',
        predictionValue: baseline,
        usedForDecision: fare.source === 'DETERMINISTIC',
        featureSnapshot: { ...snapshot, predicted_duration_min: detEta },
        metadata: { unit: 'poysha', reason: fare.reason, breakdown },
        latencyMs: null,
      },
    ];
    if (raw) {
      events.push(
        {
          modelName: raw.eta.modelName,
          modelVersion: raw.eta.modelVersion,
          predictionType: 'ETA',
          predictionValue: raw.eta.predictedDurationMin,
          usedForDecision: eta.source === 'ML',
          featureSnapshot: snapshot,
          metadata: { unit: 'minutes', reason: eta.reason, acceptedRange: [detEta * this.etaRules.mlMinRatio, detEta * this.etaRules.mlMaxRatio] },
          latencyMs: raw.latencyMs,
        },
        {
          modelName: raw.fare.modelName,
          modelVersion: raw.fare.modelVersion,
          predictionType: 'FARE',
          predictionValue: mlFarePoysha!,
          usedForDecision: fare.source === 'ML',
          featureSnapshot: { ...snapshot, predicted_duration_min: round1(raw.eta.predictedDurationMin) },
          metadata: { unit: 'poysha', reason: fare.reason, deviationBps: fare.deviationBps, allowedBand: fare.allowedBand },
          latencyMs: raw.latencyMs,
        },
      );
    }

    return { features, distanceSource, mlAvailable: raw !== null, eta, fare, fareBreakdown: { ...breakdown, pricingDurationMin: detEta, traffic: features.traffic }, events };
  }
}
