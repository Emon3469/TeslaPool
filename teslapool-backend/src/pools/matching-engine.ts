import type { PoolRules, ScoringWeights } from '../config/env';
import { DistanceProvider } from '../geography/distance-provider';
import { Zone } from '../geography/zones';
import { enumeratePlans, PassengerLeg, planSignature, PlannedPassenger, RoutePlan, RouteStop } from '../route-engine/route-planner';
import { ScoreBreakdown, scorePlan } from '../route-engine/route-scoring';
import { decisionHeadline, describeCheck } from './explain';
import { joinBlockReason, PoolStatus } from './pool-state';

/**
 * Deterministic pool matching. Pure: no I/O, no clock, no randomness, no ML.
 * The same inputs always produce the same decision, which is what makes the
 * decision explainable, testable, and safe to re-run inside the transaction.
 */

export const MatchReason = {
  POOL_JOINABLE: 'POOL_JOINABLE',
  CAPACITY_AVAILABLE: 'CAPACITY_AVAILABLE',
  PICKUP_COMPATIBLE: 'PICKUP_COMPATIBLE',
  DESTINATION_COMPATIBLE: 'DESTINATION_COMPATIBLE',
  STOP_LIMIT_SATISFIED: 'STOP_LIMIT_SATISFIED',
  DETOUR_WITHIN_LIMIT: 'DETOUR_WITHIN_LIMIT',

  POOL_ALREADY_STARTED: 'POOL_ALREADY_STARTED',
  POOL_CANCELLED: 'POOL_CANCELLED',
  LATE_JOIN_NOT_ALLOWED: 'LATE_JOIN_NOT_ALLOWED',
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  PICKUP_TOO_FAR: 'PICKUP_TOO_FAR',
  DESTINATION_TOO_FAR: 'DESTINATION_TOO_FAR',
  MAX_STOPS_EXCEEDED: 'MAX_STOPS_EXCEEDED',
  DETOUR_TOO_HIGH: 'DETOUR_TOO_HIGH',
} as const;
export type MatchReasonCode = (typeof MatchReason)[keyof typeof MatchReason];

export type HardRule = 'POOL_STATE' | 'CAPACITY' | 'PICKUP_DISTANCE' | 'DESTINATION_DISTANCE' | 'STOP_LIMIT' | 'DETOUR';

export interface RuleCheck {
  rule: HardRule;
  passed: boolean;
  code: MatchReasonCode;
  /** Plain-language reason, ready for a UI "Why?" panel. */
  message: string;
  detail: Record<string, unknown>;
}

export interface PoolSnapshot {
  id: string;
  status: PoolStatus;
  capacity: number;
  occupiedSeats: number;
  members: PlannedPassenger[];
}

export interface RouteAlternative {
  route: Zone[];
  feasible: boolean;
  violations: string[];
  totalDistanceKm: number;
  maxDetourKm: number;
  stopCount: number;
  score: number | null;
}

export interface MatchDecision {
  decision: 'MATCHED' | 'REJECTED';
  poolId: string;
  /** One-line human summary, e.g. "Not matched: Only 1 seat left, 2 requested". */
  headline: string;
  reasonCodes: MatchReasonCode[];
  checks: RuleCheck[];
  capacity: { total: number; before: number; requested: number; after: number; available: number };
  route?: Zone[];
  stops?: RouteStop[];
  totalDistanceKm?: number;
  /** Largest detour any passenger suffers on the chosen route. */
  detourKm?: number;
  passengers?: PassengerLeg[];
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  /** Other stop orders that were evaluated, shortest vehicle route first. */
  alternatives: RouteAlternative[];
}

export interface MatchContext {
  rules: PoolRules;
  weights: ScoringWeights;
  distance: DistanceProvider;
}

const MAX_ALTERNATIVES = 5;

function pickBest(plans: RoutePlan[], scores: Map<RoutePlan, ScoreBreakdown>): RoutePlan | undefined {
  return [...plans].sort(
    (a, b) =>
      scores.get(a)!.total - scores.get(b)!.total ||
      a.totalDistanceKm - b.totalDistanceKm ||
      planSignature(a).localeCompare(planSignature(b)),
  )[0];
}

/** Best feasible plan for a set of passengers (used to price the current pool and to re-plan after someone leaves). */
export function bestPlanFor(passengers: PlannedPassenger[], ctx: MatchContext): RoutePlan | undefined {
  const plans = enumeratePlans(passengers, ctx.rules, ctx.distance).filter((p) => p.feasible);
  const referenceKm = passengers.reduce((a, p) => a + ctx.distance.distanceKm(p.pickupZone, p.dropoffZone), 0);
  const scores = new Map(plans.map((p) => [p, scorePlan(p, { baselineKm: 0, referenceKm, maxStops: ctx.rules.maxStops }, ctx.weights)]));
  return pickBest(plans, scores);
}

export function evaluateCandidate(pool: PoolSnapshot, request: PlannedPassenger, ctx: MatchContext): MatchDecision {
  const { rules, distance } = ctx;
  const checks: Array<Omit<RuleCheck, 'message'> & { message?: string }> = [];

  // HARD RULE 5: pool state
  const blocked = joinBlockReason(pool.status, rules.allowLateJoin);
  checks.push({
    rule: 'POOL_STATE',
    passed: blocked === null,
    code: blocked ?? MatchReason.POOL_JOINABLE,
    detail: { status: pool.status, allowLateJoin: rules.allowLateJoin },
  });

  // HARD RULE 1: capacity (seats, never passenger count)
  const available = pool.capacity - pool.occupiedSeats;
  const capacityOk = request.seats >= 1 && available >= request.seats;
  checks.push({
    rule: 'CAPACITY',
    passed: capacityOk,
    code: capacityOk ? MatchReason.CAPACITY_AVAILABLE : MatchReason.CAPACITY_EXCEEDED,
    detail: { capacity: pool.capacity, occupied: pool.occupiedSeats, available, requested: request.seats },
  });

  // HARD RULES 2 and 3: pickup / destination proximity against EVERY existing passenger
  const worst = (hops: number[]) => (hops.length ? Math.max(...hops) : 0);
  const pickupHops = worst(pool.members.map((m) => distance.proximityHops(m.pickupZone, request.pickupZone)));
  const destHops = worst(pool.members.map((m) => distance.proximityHops(m.dropoffZone, request.dropoffZone)));
  const pickupOk = pickupHops <= rules.pickupMaxHops;
  const destOk = destHops <= rules.destinationMaxHops;
  checks.push({
    rule: 'PICKUP_DISTANCE',
    passed: pickupOk,
    code: pickupOk ? MatchReason.PICKUP_COMPATIBLE : MatchReason.PICKUP_TOO_FAR,
    detail: { maxHopsToExistingPickups: pickupHops, limitHops: rules.pickupMaxHops, existingPassengers: pool.members.length },
  });
  checks.push({
    rule: 'DESTINATION_DISTANCE',
    passed: destOk,
    code: destOk ? MatchReason.DESTINATION_COMPATIBLE : MatchReason.DESTINATION_TOO_FAR,
    detail: { maxHopsToExistingDropoffs: destHops, limitHops: rules.destinationMaxHops, existingPassengers: pool.members.length },
  });

  // HARD RULES 4 and 6: evaluate every stop order for ALL passengers (existing + new)
  const passengers = [...pool.members, request];
  const plans = enumeratePlans(passengers, rules, distance);
  const withinStops = plans.filter((p) => !p.violations.includes('MAX_STOPS_EXCEEDED'));
  const detourPool = withinStops.length ? withinStops : plans;
  const detourOk = detourPool.some((p) => !p.violations.includes('DETOUR_TOO_HIGH'));
  const minStops = Math.min(...plans.map((p) => p.stopCount));
  const minWorstDetour = Math.min(...detourPool.map((p) => p.maxDetourKm));
  const urgent = passengers.filter((p) => p.flexibility === 'URGENT');
  // Which riders' own limits block every order? (Named by flexibility so the reason is clear, e.g. an urgent rider.)
  const blockedBy = detourOk
    ? []
    : [...new Set(detourPool.flatMap((p) => p.passengers.filter((l) => l.detourKm > l.allowedDetourKm).map((l) => l.flexibility)))];
  checks.push({
    rule: 'STOP_LIMIT',
    passed: withinStops.length > 0,
    code: withinStops.length > 0 ? MatchReason.STOP_LIMIT_SATISFIED : MatchReason.MAX_STOPS_EXCEEDED,
    detail: { minimumStops: minStops, maxStops: rules.maxStops, ordersEvaluated: plans.length },
  });
  checks.push({
    rule: 'DETOUR',
    passed: detourOk,
    code: detourOk ? MatchReason.DETOUR_WITHIN_LIMIT : MatchReason.DETOUR_TOO_HIGH,
    detail: {
      bestWorstCaseDetourKm: minWorstDetour,
      maxDetourKm: rules.maxDetourKm,
      maxDetourRatio: rules.maxDetourRatio,
      policy: 'allowed = max(km, ratio * soloDistance) for each passenger’s own urgency (urgent / standard / flexible), checked for every passenger',
      urgentPassengers: urgent.length,
      requestFlexibility: request.flexibility ?? 'STANDARD',
      ...(blockedBy.length ? { limitingFlexibilities: blockedBy } : {}),
    },
  });

  // Score all plans relative to the pool's current route, so "join a pool" and
  // "take an empty vehicle" are compared on incremental vehicle-km.
  const current = bestPlanFor(pool.members, ctx);
  const scoreCtx = {
    baselineKm: current?.totalDistanceKm ?? 0,
    referenceKm: distance.distanceKm(request.pickupZone, request.dropoffZone),
    maxStops: rules.maxStops,
  };
  const scores = new Map(plans.map((p) => [p, scorePlan(p, scoreCtx, ctx.weights)]));
  const feasible = plans.filter((p) => p.feasible);
  const best = pickBest(feasible, scores);

  const alternatives: RouteAlternative[] = [...plans]
    // Shortest first: the orders a person would consider first (feasible or not) lead the explanation.
    .sort((a, b) => a.totalDistanceKm - b.totalDistanceKm || Number(b.feasible) - Number(a.feasible) || planSignature(a).localeCompare(planSignature(b)))
    .filter((p) => p !== best)
    .slice(0, MAX_ALTERNATIVES)
    .map((p) => ({
      route: p.zones,
      feasible: p.feasible,
      violations: p.violations,
      totalDistanceKm: p.totalDistanceKm,
      maxDetourKm: p.maxDetourKm,
      stopCount: p.stopCount,
      score: p.feasible ? scores.get(p)!.total : null,
    }));

  // Report the detour of the route actually chosen (not merely the best possible worst case).
  if (best) {
    const detour = checks.find((c) => c.rule === 'DETOUR')!;
    detour.detail = { ...detour.detail, chosenRouteMaxDetourKm: best.maxDetourKm };
    const stops = checks.find((c) => c.rule === 'STOP_LIMIT')!;
    stops.detail = { ...stops.detail, chosenRouteStops: best.stopCount };
  }
  const explained: RuleCheck[] = checks.map((c) => ({ ...c, message: describeCheck(c.rule, c.passed, c.code, c.detail) }));
  const failed = explained.filter((c) => !c.passed);
  const matched = failed.length === 0 && best !== undefined;
  const capacity = {
    total: pool.capacity,
    before: pool.occupiedSeats,
    requested: request.seats,
    after: pool.occupiedSeats + (matched ? request.seats : 0),
    available,
  };

  if (!matched) {
    return {
      decision: 'REJECTED',
      poolId: pool.id,
      headline: decisionHeadline('REJECTED', failed.map((c) => c.message)),
      reasonCodes: failed.map((c) => c.code),
      checks: explained,
      capacity,
      alternatives,
    };
  }
  return {
    decision: 'MATCHED',
    poolId: pool.id,
    headline: decisionHeadline('MATCHED', [], best.zones),
    reasonCodes: explained.map((c) => c.code),
    checks: explained,
    capacity,
    route: best.zones,
    stops: best.stops,
    totalDistanceKm: best.totalDistanceKm,
    detourKm: best.maxDetourKm,
    passengers: best.passengers,
    score: scores.get(best)!.total,
    scoreBreakdown: scores.get(best)!,
    alternatives,
  };
}

/** Rank candidate decisions: matched first, lowest score first, then pool id for determinism. */
export function rankDecisions(decisions: MatchDecision[]): MatchDecision[] {
  return [...decisions].sort(
    (a, b) =>
      Number(b.decision === 'MATCHED') - Number(a.decision === 'MATCHED') ||
      (a.score ?? Infinity) - (b.score ?? Infinity) ||
      a.poolId.localeCompare(b.poolId),
  );
}
