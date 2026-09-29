import type { ScoringWeights } from '../config/env';
import { RoutePlan } from './route-planner';

/**
 * Deterministic route score (LOWER is better), applied only AFTER hard constraints pass:
 *
 *   S = wd*distance + wdetour*detour + wstops*stops + wtime*timeVariance - wshare*sharing
 *
 * Every component is normalised to [0, 1]:
 *   distance      incremental vehicle-km this assignment adds, relative to the reference trip
 *                 (1 = as costly as a dedicated vehicle, 0 = free ride-along)
 *   detour        worst passenger detour / that passenger's allowed detour
 *   stops         stop count / MAX_STOPS
 *   timeVariance  std-dev of per-passenger detour ratios (fairness: nobody absorbs all the detour)
 *   sharing       mean fraction of in-vehicle distance ridden together (the pooling benefit;
 *                 stands in for the spec's "wait benefit", for which we have no wait data yet)
 *
 * Weights come from configuration (SCORE_WEIGHT_*), never from code.
 */

export interface ScoreBreakdown {
  distance: number;
  detour: number;
  stops: number;
  timeVariance: number;
  sharing: number;
  total: number;
}

export interface ScoreContext {
  /** Vehicle-km of the pool's route before this change (0 for an empty pool). */
  baselineKm: number;
  /** Denominator for the distance term: the joining passenger's solo km (or total solo km when re-planning). */
  referenceKm: number;
  maxStops: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function scorePlan(plan: RoutePlan, ctx: ScoreContext, weights: ScoringWeights): ScoreBreakdown {
  const distance = ctx.referenceKm > 0 ? clamp01((plan.totalDistanceKm - ctx.baselineKm) / ctx.referenceKm) : 0;
  const detour = clamp01(Math.max(0, ...plan.passengers.map((p) => (p.allowedDetourKm > 0 ? p.detourKm / p.allowedDetourKm : 0))));
  const stops = clamp01(plan.stopCount / ctx.maxStops);

  const ratios = plan.passengers.map((p) => (p.soloDistanceKm > 0 ? p.detourKm / p.soloDistanceKm : 0));
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const timeVariance = clamp01(Math.sqrt(ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length));

  const sharing = clamp01(plan.passengers.reduce((a, p) => a + p.sharedFraction, 0) / plan.passengers.length);

  const total =
    weights.distance * distance +
    weights.detour * detour +
    weights.stops * stops +
    weights.timeVariance * timeVariance -
    weights.sharing * sharing;

  return {
    distance: r4(distance),
    detour: r4(detour),
    stops: r4(stops),
    timeVariance: r4(timeVariance),
    sharing: r4(sharing),
    total: r4(total),
  };
}
