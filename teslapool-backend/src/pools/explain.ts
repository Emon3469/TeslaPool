import { ZONE_INFO, type Zone } from '../geography/zones';
import type { HardRule, MatchReasonCode } from './matching-engine';

/**
 * Plain-language explanations of engine decisions. Pure functions of the check data,
 * so every decision explains itself identically wherever it appears (pool options,
 * join responses, rejected-join errors, the ride explanation endpoint).
 */

type Detail = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const seats = (k: number) => `${k} seat${k === 1 ? '' : 's'}`;

export function describeCheck(rule: HardRule, passed: boolean, code: MatchReasonCode, d: Detail): string {
  switch (rule) {
    case 'POOL_STATE':
      if (passed) return 'Pool is open for new passengers';
      if (code === 'LATE_JOIN_NOT_ALLOWED') return 'Driver has already arrived for pickup; late joins are disabled';
      if (code === 'POOL_CANCELLED') return 'Pool was cancelled';
      return 'Trip has already started; no new passengers can join';
    case 'CAPACITY':
      return passed
        ? `${seats(n(d.available))} available, ${n(d.requested)} requested`
        : `Only ${seats(n(d.available))} left, ${n(d.requested)} requested`;
    case 'PICKUP_DISTANCE': {
      if (n(d.existingPassengers) === 0) return 'First passenger: any pickup zone works';
      const hops = n(d.maxHopsToExistingPickups);
      if (passed) return hops === 0 ? 'Same pickup zone as current passengers' : `Pickup within ${hops} zone of current passengers`;
      return `Pickup is ${hops} zones from current passengers (limit ${n(d.limitHops)})`;
    }
    case 'DESTINATION_DISTANCE': {
      if (n(d.existingPassengers) === 0) return 'First passenger: any destination works';
      const hops = n(d.maxHopsToExistingDropoffs);
      if (passed) return hops === 0 ? 'Same destination zone as current passengers' : `Destination within ${hops} zone${hops === 1 ? '' : 's'} of current passengers`;
      return `Destination is ${hops} zones from current passengers' (limit ${n(d.limitHops)})`;
    }
    case 'STOP_LIMIT':
      return passed
        ? `Route has ${n(d.chosenRouteStops ?? d.minimumStops)} stops (limit ${n(d.maxStops)})`
        : `Every route would need more than ${n(d.maxStops)} stops`;
    case 'DETOUR':
      if (!passed) return `Every possible route adds too much detour for someone (best case ${n(d.bestWorstCaseDetourKm)} km)`;
      return d.chosenRouteMaxDetourKm !== undefined
        ? `Chosen route adds at most ${n(d.chosenRouteMaxDetourKm)} km for any passenger (within each passenger's limit)`
        : `A route exists within every passenger's detour limit`;
  }
}

export const routeLabel = (route: readonly string[]) => route.map((z) => ZONE_INFO[z as Zone]?.displayName ?? z).join(' → ');

export function decisionHeadline(decision: 'MATCHED' | 'REJECTED', failedMessages: string[], route?: readonly string[]): string {
  if (decision === 'MATCHED') return `Matched: ${route ? routeLabel(route) : 'compatible route'}`;
  return `Not matched: ${failedMessages.join('; ')}`;
}
