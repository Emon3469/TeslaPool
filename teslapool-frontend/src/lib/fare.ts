import { divRoundHalfUp } from './format';
import type { Meta } from './types';

export interface FareRates {
  basePoysha: number;
  perKmPoysha: number;
  perMinPoysha: number;
}

export interface FareBreakdown {
  basePoysha: number;
  distanceChargePoysha: number;
  timeChargePoysha: number;
  totalPoysha: number;
}

/**
 * The standard (solo) fare, computed exactly as the API does:
 * base + distance (per metre, half-up) + time (per second, half-up), all in integer poysha.
 */
export function standardFare(distanceKm: number, durationMin: number, rates: FareRates): FareBreakdown {
  const metres = Math.round(distanceKm * 1000);
  const seconds = Math.round(durationMin * 60);
  const distanceChargePoysha = divRoundHalfUp(metres * rates.perKmPoysha, 1000);
  const timeChargePoysha = divRoundHalfUp(seconds * rates.perMinPoysha, 60);
  return {
    basePoysha: rates.basePoysha,
    distanceChargePoysha,
    timeChargePoysha,
    totalPoysha: rates.basePoysha + distanceChargePoysha + timeChargePoysha,
  };
}

/** A passenger's pooled fare: the solo fare minus a discount in basis points (half-up). */
export function applyDiscountBps(farePoysha: number, discountBps: number): number {
  return divRoundHalfUp(farePoysha * (10_000 - discountBps), 10_000);
}

export function ratesFromMeta(meta: Pick<Meta, 'fare'>): FareRates {
  return { basePoysha: meta.fare.basePoysha, perKmPoysha: meta.fare.perKmPoysha, perMinPoysha: meta.fare.perMinPoysha };
}

/** Zone-graph distance between two zones from `/meta`, or null when the graph has no entry. */
export function zoneDistanceKm(meta: Pick<Meta, 'distanceKm'>, from: string, to: string): number | null {
  return meta.distanceKm[from]?.[to] ?? meta.distanceKm[to]?.[from] ?? null;
}
