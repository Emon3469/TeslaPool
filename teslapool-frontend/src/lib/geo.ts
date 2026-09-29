import type { Zone } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

/** The API accepts exact points only inside this box (CreateRideRequest lat/lng bounds). */
export const DHAKA_BOUNDS = { minLat: 23.6, maxLat: 24.1, minLng: 90.2, maxLng: 90.7 } as const;

export const DHAKA_CENTER: LatLng = { lat: 23.7925, lng: 90.4078 };

export function inDhaka(p: LatLng): boolean {
  return p.lat >= DHAKA_BOUNDS.minLat && p.lat <= DHAKA_BOUNDS.maxLat && p.lng >= DHAKA_BOUNDS.minLng && p.lng <= DHAKA_BOUNDS.maxLng;
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The service zone whose centre is closest to a point, with the distance to that centre. */
export function nearestZone(p: LatLng, zones: Zone[]): { zone: Zone; km: number } | null {
  let best: { zone: Zone; km: number } | null = null;
  for (const zone of zones) {
    const km = haversineKm(p, zone.center);
    if (!best || km < best.km) best = { zone, km };
  }
  return best;
}

/** 23.79372, 90.40661 → "23.7937° N, 90.4066° E" */
export function formatLatLng(p: LatLng, digits = 4): string {
  return `${p.lat.toFixed(digits)}° N, ${p.lng.toFixed(digits)}° E`;
}

/** Rounds to ~1 m, enough for a pickup pin and keeps payloads tidy. */
export const roundCoord = (n: number) => Math.round(n * 1e5) / 1e5;
