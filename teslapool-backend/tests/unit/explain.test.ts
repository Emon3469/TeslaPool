import { ZoneGraphDistanceProvider } from '../../src/geography/distance-provider';
import { describeCheck } from '../../src/pools/explain';
import { evaluateCandidate, MatchContext } from '../../src/pools/matching-engine';

const ctx: MatchContext = {
  rules: { maxCapacity: 3, pickupMaxHops: 1, destinationMaxHops: 2, maxDetourKm: 1.5, maxDetourRatio: 0.3, maxStops: 4, allowLateJoin: false, candidateLimit: 50 },
  weights: { distance: 0.35, detour: 0.25, stops: 0.15, timeVariance: 0.1, sharing: 0.15 },
  distance: new ZoneGraphDistanceProvider(),
};
const p = (id: string, pickupZone: 'BANANI' | 'MOHAKHALI' | 'GULSHAN' | 'UTTARA', dropoffZone: 'BANANI' | 'MOHAKHALI' | 'GULSHAN' | 'UTTARA', seats = 1) => ({ rideRequestId: id, pickupZone, dropoffZone, seats });

describe('plain-language explanations', () => {
  it('describes the route that was actually chosen, not the best theoretical case', () => {
    const d = evaluateCandidate({ id: 'p', status: 'MATCHED', capacity: 3, occupiedSeats: 1, members: [p('n', 'BANANI', 'MOHAKHALI')] }, p('r', 'BANANI', 'GULSHAN'), ctx);
    const byRule = Object.fromEntries(d.checks.map((c) => [c.rule, c.message]));
    expect(byRule.DETOUR).toBe("Chosen route adds at most 1.1 km for any passenger (within each passenger's limit)");
    expect(byRule.STOP_LIMIT).toBe('Route has 3 stops (limit 4)');
    expect(d.headline).toBe('Matched: Banani → Gulshan 1 → Mohakhali');
  });

  it('joins every failed reason into the rejection headline', () => {
    const d = evaluateCandidate(
      { id: 'p', status: 'STARTED', capacity: 3, occupiedSeats: 3, members: [p('a', 'BANANI', 'MOHAKHALI'), p('b', 'BANANI', 'GULSHAN', 2)] },
      p('x', 'MOHAKHALI', 'BANANI'),
      ctx,
    );
    expect(d.headline).toBe('Not matched: Trip has already started; no new passengers can join; Only 0 seats left, 1 requested; Pickup is 2 zones from current passengers (limit 1)');
  });

  it.each([
    ['CAPACITY', true, 'CAPACITY_AVAILABLE', { available: 1, requested: 1 }, '1 seat available, 1 requested'],
    ['CAPACITY', false, 'CAPACITY_EXCEEDED', { available: 1, requested: 2 }, 'Only 1 seat left, 2 requested'],
    ['PICKUP_DISTANCE', true, 'PICKUP_COMPATIBLE', { existingPassengers: 0, maxHopsToExistingPickups: 0 }, 'First passenger: any pickup zone works'],
    ['PICKUP_DISTANCE', true, 'PICKUP_COMPATIBLE', { existingPassengers: 2, maxHopsToExistingPickups: 0 }, 'Same pickup zone as current passengers'],
    ['DESTINATION_DISTANCE', false, 'DESTINATION_TOO_FAR', { existingPassengers: 1, maxHopsToExistingDropoffs: 4, limitHops: 2 }, "Destination is 4 zones from current passengers (limit 2)"],
    ['POOL_STATE', false, 'LATE_JOIN_NOT_ALLOWED', {}, 'Driver has already arrived for pickup; late joins are disabled'],
  ] as const)('%s %s -> %s', (rule, passed, code, detail, expected) => {
    expect(describeCheck(rule, passed, code, detail)).toBe(expected);
  });
});
