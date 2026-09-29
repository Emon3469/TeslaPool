import type { CreatedRide } from './types';

/**
 * The pool options exist only in the `POST /rides` response, so the request page hands them to
 * the matching page through sessionStorage (per tab, never shared, gone when the tab closes).
 */
const key = (rideId: string) => `tp:created-ride:${rideId}`;

export function saveCreatedRide(ride: CreatedRide): void {
  try {
    sessionStorage.setItem(key(ride.rideRequestId), JSON.stringify({ savedAt: Date.now(), ride }));
  } catch {
    // Storage unavailable: the matching page falls back to live auto-matching.
  }
}

export function readCreatedRide(rideId: string): { savedAt: number; ride: CreatedRide } | null {
  try {
    const raw = sessionStorage.getItem(key(rideId));
    return raw ? (JSON.parse(raw) as { savedAt: number; ride: CreatedRide }) : null;
  } catch {
    return null;
  }
}

export function forgetCreatedRide(rideId: string): void {
  try {
    sessionStorage.removeItem(key(rideId));
  } catch {
    // Nothing to clean up.
  }
}
