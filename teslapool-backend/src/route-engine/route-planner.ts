import { DistanceProvider } from '../geography/distance-provider';
import { Zone } from '../geography/zones';

/**
 * Pure route planning: enumerate every stop order in which each passenger is
 * picked up before being dropped off, merge consecutive stops in the same zone,
 * and evaluate distance, per-passenger detour, stop count and shared riding.
 *
 * With capacity 3 there are at most 6!/2^3 = 90 orders, so exhaustive search is
 * cheap, exact and deterministic. No heuristics, no randomness.
 */

/**
 * How much detour a passenger accepts, chosen when they request the ride:
 *   URGENT    almost direct (e.g. already late): the route must go their way first
 *   STANDARD  the default rule
 *   FLEXIBLE  happy to ride further so more people can share
 * Urgency never borrows from anyone else: every order must satisfy EVERY passenger's own limit.
 */
export type Flexibility = 'URGENT' | 'STANDARD' | 'FLEXIBLE';
export const FLEXIBILITIES: readonly Flexibility[] = ['URGENT', 'STANDARD', 'FLEXIBLE'];

export interface DetourLimit {
  km: number;
  ratio: number;
}

export interface PlannedPassenger {
  rideRequestId: string;
  pickupZone: Zone;
  dropoffZone: Zone;
  seats: number;
  /** Defaults to STANDARD. */
  flexibility?: Flexibility;
}

export interface RouteRules {
  /** STANDARD limit. */
  maxDetourKm: number;
  maxDetourRatio: number;
  maxStops: number;
  urgentDetour?: DetourLimit;
  flexibleDetour?: DetourLimit;
}

export const DEFAULT_URGENT_DETOUR: DetourLimit = { km: 0.5, ratio: 0.1 };
export const DEFAULT_FLEXIBLE_DETOUR: DetourLimit = { km: 3, ratio: 0.6 };

export function detourLimitFor(flexibility: Flexibility | undefined, rules: RouteRules): DetourLimit {
  if (flexibility === 'URGENT') return rules.urgentDetour ?? DEFAULT_URGENT_DETOUR;
  if (flexibility === 'FLEXIBLE') return rules.flexibleDetour ?? DEFAULT_FLEXIBLE_DETOUR;
  return { km: rules.maxDetourKm, ratio: rules.maxDetourRatio };
}

export interface RouteStop {
  zone: Zone;
  pickups: string[];
  dropoffs: string[];
}

export interface PassengerLeg {
  rideRequestId: string;
  flexibility: Flexibility;
  pickupSequence: number;
  dropoffSequence: number;
  soloDistanceKm: number;
  inVehicleDistanceKm: number;
  /** Extra km versus a direct trip: waiting while the vehicle serves others before pickup + in-vehicle detour. */
  detourKm: number;
  allowedDetourKm: number;
  sharedDistanceKm: number;
  /** Fraction of this passenger's in-vehicle distance ridden with at least one other passenger. */
  sharedFraction: number;
}

export type RouteViolation = 'MAX_STOPS_EXCEEDED' | 'DETOUR_TOO_HIGH';

export interface RoutePlan {
  stops: RouteStop[];
  zones: Zone[];
  totalDistanceKm: number;
  stopCount: number;
  passengers: PassengerLeg[];
  maxDetourKm: number;
  violations: RouteViolation[];
  feasible: boolean;
}

const EPS = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Detour allowance for one passenger. The spec gives two limits ("1.5 km or 30%
 * of the original route"); we apply the MORE PERMISSIVE of the two:
 *   allowed = max(MAX_DETOUR_KM, MAX_DETOUR_RATIO * soloDistance)
 * so short trips get an absolute 1.5 km floor and long trips a proportional
 * allowance. Example: 3.4 km solo -> max(1.5, 1.02) = 1.5 km.
 * URGENT and FLEXIBLE passengers use their own (km, ratio) pair with the same formula:
 * urgent 3.4 km -> max(0.5, 0.34) = 0.5 km; flexible 2.5 km -> max(3, 1.5) = 3 km.
 */
export function allowedDetourKm(soloDistanceKm: number, rules: RouteRules, flexibility?: Flexibility): number {
  const limit = detourLimitFor(flexibility, rules);
  return Math.max(limit.km, limit.ratio * soloDistanceKm);
}

type Event = { kind: 'pickup' | 'dropoff'; passenger: PlannedPassenger };

function enumerateEventOrders(passengers: PlannedPassenger[]): Event[][] {
  const orders: Event[][] = [];
  const picked = new Set<string>();
  const dropped = new Set<string>();
  const current: Event[] = [];
  const total = passengers.length * 2;

  const walk = () => {
    if (current.length === total) {
      orders.push([...current]);
      return;
    }
    for (const p of passengers) {
      if (!picked.has(p.rideRequestId)) {
        picked.add(p.rideRequestId);
        current.push({ kind: 'pickup', passenger: p });
        walk();
        current.pop();
        picked.delete(p.rideRequestId);
      } else if (!dropped.has(p.rideRequestId)) {
        dropped.add(p.rideRequestId);
        current.push({ kind: 'dropoff', passenger: p });
        walk();
        current.pop();
        dropped.delete(p.rideRequestId);
      }
    }
  };
  walk();
  return orders;
}

function mergeIntoStops(events: Event[]): RouteStop[] {
  const stops: RouteStop[] = [];
  for (const e of events) {
    const zone = e.kind === 'pickup' ? e.passenger.pickupZone : e.passenger.dropoffZone;
    let last = stops[stops.length - 1];
    if (!last || last.zone !== zone) {
      last = { zone, pickups: [], dropoffs: [] };
      stops.push(last);
    }
    (e.kind === 'pickup' ? last.pickups : last.dropoffs).push(e.passenger.rideRequestId);
  }
  return stops;
}

export function evaluateStops(
  stops: RouteStop[],
  passengers: PlannedPassenger[],
  rules: RouteRules,
  distance: DistanceProvider,
): RoutePlan {
  const cumulative: number[] = [0];
  const legKm: number[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const km = distance.distanceKm(stops[i].zone, stops[i + 1].zone);
    legKm.push(km);
    cumulative.push(cumulative[i] + km);
  }

  const index = new Map<string, { pu: number; do: number }>();
  stops.forEach((s, i) => {
    for (const id of s.pickups) index.set(id, { ...(index.get(id) ?? { do: -1 }), pu: i });
    for (const id of s.dropoffs) index.set(id, { ...(index.get(id) ?? { pu: -1 }), do: i });
  });

  // Detour a passenger's limit is checked against = extra distance BEFORE pickup (the vehicle serves others
  // first while they wait) + extra distance IN the vehicle. Counting only in-vehicle distance would accept
  // "drop Rafiq at Gulshan, come back to Banani for Nusrat": zero in-vehicle detour, but a 5 km wait.
  const start = stops[0].zone;
  const excessKm = (p: PlannedPassenger, pu: number, dropIdx: number, solo: number) =>
    cumulative[pu] - distance.distanceKm(start, p.pickupZone) + (cumulative[dropIdx] - cumulative[pu] - solo);

  const legs: PassengerLeg[] = passengers.map((p) => {
    const { pu, do: dropIdx } = index.get(p.rideRequestId)!;
    const solo = distance.distanceKm(p.pickupZone, p.dropoffZone);
    const inVehicle = cumulative[dropIdx] - cumulative[pu];
    let shared = 0;
    for (let leg = pu; leg < dropIdx; leg++) {
      const othersOnboard = passengers.some((q) => {
        if (q.rideRequestId === p.rideRequestId) return false;
        const qi = index.get(q.rideRequestId)!;
        return qi.pu <= leg && leg < qi.do;
      });
      if (othersOnboard) shared += legKm[leg];
    }
    return {
      rideRequestId: p.rideRequestId,
      flexibility: p.flexibility ?? 'STANDARD',
      pickupSequence: pu,
      dropoffSequence: dropIdx,
      soloDistanceKm: round2(solo),
      inVehicleDistanceKm: round2(inVehicle),
      detourKm: round2(Math.max(0, excessKm(p, pu, dropIdx, solo))),
      allowedDetourKm: round2(allowedDetourKm(solo, rules, p.flexibility)),
      sharedDistanceKm: round2(shared),
      sharedFraction: inVehicle > 0 ? Math.round((shared / inVehicle) * 10_000) / 10_000 : 0,
    };
  });

  const violations: RouteViolation[] = [];
  if (stops.length > rules.maxStops) violations.push('MAX_STOPS_EXCEEDED');
  // Compare unrounded values so rounding can never turn a violation into a pass.
  const detourViolated = passengers.some((p) => {
    const { pu, do: dropIdx } = index.get(p.rideRequestId)!;
    const solo = distance.distanceKm(p.pickupZone, p.dropoffZone);
    return excessKm(p, pu, dropIdx, solo) > allowedDetourKm(solo, rules, p.flexibility) + EPS;
  });
  if (detourViolated) violations.push('DETOUR_TOO_HIGH');

  return {
    stops,
    zones: stops.map((s) => s.zone),
    totalDistanceKm: round2(cumulative[cumulative.length - 1]),
    stopCount: stops.length,
    passengers: legs,
    maxDetourKm: round2(Math.max(0, ...legs.map((l) => l.detourKm))),
    violations,
    feasible: violations.length === 0,
  };
}

const signature = (stops: RouteStop[]) =>
  stops.map((s) => `${s.zone}[+${[...s.pickups].sort().join(',')}|-${[...s.dropoffs].sort().join(',')}]`).join('>');

/** Every distinct stop plan for these passengers, in a deterministic order. */
export function enumeratePlans(
  passengers: PlannedPassenger[],
  rules: RouteRules,
  distance: DistanceProvider,
): RoutePlan[] {
  if (passengers.length === 0) return [];
  const seen = new Set<string>();
  const plans: RoutePlan[] = [];
  for (const order of enumerateEventOrders(passengers)) {
    const stops = mergeIntoStops(order);
    const sig = signature(stops);
    if (seen.has(sig)) continue;
    seen.add(sig);
    plans.push(evaluateStops(stops, passengers, rules, distance));
  }
  return plans;
}

export function planSignature(plan: RoutePlan): string {
  return signature(plan.stops);
}
