import { describe, expect, it } from 'vitest';
import { riderStats } from './stats';
import type { Ride } from './types';

const m = (p: number) => ({ amountPoysha: p, amountBdt: p / 100, currency: 'BDT' as const });

function ride(over: Partial<Ride> & { from: string; to: string }): Ride {
  const { from, to, ...rest } = over;
  return {
    rideRequestId: Math.random().toString(36),
    status: 'COMPLETED',
    phase: 'COMPLETED',
    pickup: { zone: from, name: from, lat: null, lng: null },
    dropoff: { zone: to, name: to, lat: null, lng: null },
    requestedSeats: 1,
    vehicleType: 'AUTO_RICKSHAW',
    estimatedDistanceKm: 3.4,
    distanceSource: 'ZONE_GRAPH_DISTANCE',
    estimatedDurationMinutes: 17,
    estimatedFare: m(12650),
    fareSource: 'DETERMINISTIC',
    fareBreakdown: null,
    paymentMethod: 'CASH',
    payment: null,
    pool: null,
    finalFare: null,
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
    ...rest,
  } as Ride;
}

describe('riderStats', () => {
  it('sums spend and pooled savings from completed rides only', () => {
    const pool = { poolId: 'p', membershipStatus: 'COMPLETED', fare: m(10893), soloFare: m(12650), discountPercent: 13.89, pickupSequence: 0, dropoffSequence: 2, detourKm: 0 };
    const s = riderStats([
      ride({ from: 'BANANI', to: 'MOHAKHALI', pool, payment: { method: 'CASH', amount: m(10893), settledAt: 'x' } }),
      ride({ from: 'BANANI', to: 'MOHAKHALI', finalFare: m(12650) }),
      ride({ from: 'BANANI', to: 'GULSHAN', status: 'CANCELLED', phase: 'CANCELLED' }),
    ]);
    expect(s).toMatchObject({ trips: 3, completed: 2, pooled: 1, spentPoysha: 10893 + 12650, savedPoysha: 12650 - 10893 });
    expect(s.favourites[0]).toEqual({ pickup: 'BANANI', dropoff: 'MOHAKHALI', count: 2 });
  });

  it('handles a rider with no trips', () => {
    expect(riderStats([])).toEqual({ trips: 0, completed: 0, pooled: 0, spentPoysha: 0, savedPoysha: 0, favourites: [] });
  });
});
