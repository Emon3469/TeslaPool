import type { Ride } from './types';

export interface RiderStats {
  trips: number;
  completed: number;
  pooled: number;
  spentPoysha: number;
  savedPoysha: number;
  favourites: { pickup: string; dropoff: string; count: number }[];
}

/**
 * A rider's own totals, from their rides: paid amounts for spend, and solo-minus-pooled fare
 * on completed pooled trips for savings (the same definition the impact page uses).
 */
export function riderStats(rides: Ride[]): RiderStats {
  let completed = 0;
  let pooled = 0;
  let spent = 0;
  let saved = 0;
  const routes = new Map<string, { pickup: string; dropoff: string; count: number }>();

  for (const r of rides) {
    const key = `${r.pickup.zone}>${r.dropoff.zone}`;
    const fav = routes.get(key) ?? { pickup: r.pickup.zone, dropoff: r.dropoff.zone, count: 0 };
    fav.count += 1;
    routes.set(key, fav);
    if (r.status !== 'COMPLETED') continue;
    completed += 1;
    spent += r.payment?.amount.amountPoysha ?? r.finalFare?.amountPoysha ?? 0;
    if (r.pool && r.pool.discountPercent > 0) {
      pooled += 1;
      saved += Math.max(0, r.pool.soloFare.amountPoysha - r.pool.fare.amountPoysha);
    }
  }

  const favourites = [...routes.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  return { trips: rides.length, completed, pooled, spentPoysha: spent, savedPoysha: saved, favourites };
}
