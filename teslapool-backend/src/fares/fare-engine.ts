import type { FareRates } from '../config/env';

/**
 * Deterministic fare engine. ALL money is integer poysha (1 BDT = 100 poysha)
 * and all ratios are integer basis points (1 bps = 0.01%). No floating-point
 * value is ever stored or compared as money.
 *
 *   soloFare      = base + distanceKm * perKm + durationMin * perMin
 *   poolDiscount  = min(maxDiscount, alpha * sharedFraction)
 *   passengerFare = soloFare * (1 - poolDiscount)
 *
 * Physical inputs are converted to integers first (metres, seconds), then
 * multiplied by integer rates and divided with explicit half-up rounding.
 */

export const BPS = 10_000;

/** Integer division rounded half-up. Both arguments must be non-negative integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0) {
    throw new RangeError(`divRoundHalfUp expects non-negative safe integers, got ${numerator}/${denominator}`);
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export const poyshaToBdt = (poysha: number): number => poysha / 100;

export function money(poysha: number) {
  return { amountPoysha: poysha, amountBdt: poyshaToBdt(poysha), currency: 'BDT' as const };
}

export interface SoloFareBreakdown {
  basePoysha: number;
  distanceChargePoysha: number;
  timeChargePoysha: number;
  totalPoysha: number;
}

/** Itemised solo fare; the three components always sum exactly to the total. */
export function soloFareBreakdown(distanceKm: number, durationMin: number, rates: FareRates): SoloFareBreakdown {
  if (!(distanceKm >= 0) || !(durationMin >= 0)) throw new RangeError('distance and duration must be non-negative');
  const metres = Math.round(distanceKm * 1000);
  const seconds = Math.round(durationMin * 60);
  const distanceChargePoysha = divRoundHalfUp(metres * rates.perKmPoysha, 1000);
  const timeChargePoysha = divRoundHalfUp(seconds * rates.perMinPoysha, 60);
  return { basePoysha: rates.basePoysha, distanceChargePoysha, timeChargePoysha, totalPoysha: rates.basePoysha + distanceChargePoysha + timeChargePoysha };
}

export function soloFarePoysha(distanceKm: number, durationMin: number, rates: FareRates): number {
  return soloFareBreakdown(distanceKm, durationMin, rates).totalPoysha;
}

/** "৳127.15" */
export const formatBdt = (poysha: number) => `৳${(poysha / 100).toFixed(2)}`;

/** sharedFraction in [0,1] -> discount in bps, capped at maxDiscount. */
export function poolDiscountBps(sharedFraction: number, rates: FareRates): number {
  const sharedBps = Math.min(BPS, Math.max(0, Math.round(sharedFraction * BPS)));
  return Math.min(rates.maxDiscountBps, divRoundHalfUp(rates.poolAlphaBps * sharedBps, BPS));
}

export function applyDiscount(farePoysha: number, discountBps: number): number {
  return divRoundHalfUp(farePoysha * (BPS - discountBps), BPS);
}

export interface PooledFare {
  soloFarePoysha: number;
  sharedFraction: number;
  discountBps: number;
  discountPercent: number;
  farePoysha: number;
}

export function pooledFare(soloFare: number, sharedFraction: number, rates: FareRates): PooledFare {
  const discountBps = poolDiscountBps(sharedFraction, rates);
  return {
    soloFarePoysha: soloFare,
    sharedFraction,
    discountBps,
    discountPercent: discountBps / 100,
    farePoysha: applyDiscount(soloFare, discountBps),
  };
}

// ── Pricing decision (deterministic by default, ML advisory) ────────────────

export type FareSource = 'ML' | 'DETERMINISTIC';
export type FareReason = 'DETERMINISTIC_PRICING' | 'ML_WITHIN_GUARDRAIL' | 'FARE_GUARDRAIL_TRIGGERED' | 'ML_PREDICTION_UNAVAILABLE';
export type PricingMode = 'deterministic' | 'ml_guarded';

export interface FareDecision {
  pricingMode: PricingMode;
  baselineFarePoysha: number;
  mlPredictedFarePoysha: number | null;
  /** Would the ML fare pass the ±band guardrail? null when there is no ML fare. Reported in both modes. */
  mlWithinGuardrail: boolean | null;
  guardrailApplied: boolean;
  finalFarePoysha: number;
  source: FareSource;
  reason: FareReason;
  deviationBps: number | null;
  allowedBand: { minPoysha: number; maxPoysha: number };
  modelVersion: string | null;
}

/**
 * Decide the solo fare quote.
 *
 *  - pricingMode "deterministic" (default): the price is ALWAYS the rule-based baseline, so an
 *    evaluator can reproduce it by hand. The ML fare is still computed, logged and reported as an
 *    advisory signal (`mlPredictedFarePoysha`, `mlWithinGuardrail`), but it never sets the price.
 *  - pricingMode "ml_guarded": the ML fare is used only inside a ±band around the baseline.
 *    Baseline ৳130, 20% band -> [৳104, ৳156]: ML ৳148 is accepted, ML ৳240 falls back to ৳130.
 */
export function applyFareGuardrail(
  baselinePoysha: number,
  mlPoysha: number | null,
  modelVersion: string | null,
  rates: FareRates,
): FareDecision {
  const band = {
    minPoysha: divRoundHalfUp(baselinePoysha * (BPS - rates.mlMaxDeviationBps), BPS),
    maxPoysha: divRoundHalfUp(baselinePoysha * (BPS + rates.mlMaxDeviationBps), BPS),
  };
  const usable = mlPoysha !== null && Number.isSafeInteger(mlPoysha) && mlPoysha > 0;
  const deviationBps = usable ? (baselinePoysha > 0 ? divRoundHalfUp(Math.abs(mlPoysha! - baselinePoysha) * BPS, baselinePoysha) : BPS) : null;
  // Compare exactly in integers: |ml - base| * BPS <= tolerance * base
  const within = usable ? Math.abs(mlPoysha! - baselinePoysha) * BPS <= rates.mlMaxDeviationBps * baselinePoysha : null;
  const common = { pricingMode: rates.pricingMode, baselineFarePoysha: baselinePoysha, mlPredictedFarePoysha: mlPoysha, mlWithinGuardrail: within, deviationBps, allowedBand: band, modelVersion };

  if (rates.pricingMode === 'deterministic') {
    return { ...common, guardrailApplied: false, finalFarePoysha: baselinePoysha, source: 'DETERMINISTIC', reason: 'DETERMINISTIC_PRICING' };
  }
  if (!usable) {
    return { ...common, guardrailApplied: false, finalFarePoysha: baselinePoysha, source: 'DETERMINISTIC', reason: 'ML_PREDICTION_UNAVAILABLE' };
  }
  return {
    ...common,
    guardrailApplied: !within,
    finalFarePoysha: within ? mlPoysha! : baselinePoysha,
    source: within ? 'ML' : 'DETERMINISTIC',
    reason: within ? 'ML_WITHIN_GUARDRAIL' : 'FARE_GUARDRAIL_TRIGGERED',
  };
}
