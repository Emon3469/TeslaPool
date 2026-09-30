import { ZoneGraphDistanceProvider } from '../../src/geography/distance-provider';
import { evaluateCandidate, MatchContext, PoolSnapshot, rankDecisions } from '../../src/pools/matching-engine';
import type { PlannedPassenger } from '../../src/route-engine/route-planner';

const ctx: MatchContext = {
  rules: { maxCapacity: 3, pickupMaxHops: 1, destinationMaxHops: 2, maxDetourKm: 1.5, maxDetourRatio: 0.3, urgentDetour: { km: 0.5, ratio: 0.1 }, flexibleDetour: { km: 3, ratio: 0.6 }, maxStops: 4, allowLateJoin: false, candidateLimit: 50 },
  weights: { distance: 0.35, detour: 0.25, stops: 0.15, timeVariance: 0.1, sharing: 0.15 },
  distance: new ZoneGraphDistanceProvider(),
};

const p = (id: string, pickupZone: PlannedPassenger['pickupZone'], dropoffZone: PlannedPassenger['dropoffZone'], seats = 1): PlannedPassenger => ({ rideRequestId: id, pickupZone, dropoffZone, seats });
const pool = (members: PlannedPassenger[], over: Partial<PoolSnapshot> = {}): PoolSnapshot => ({
  id: over.id ?? 'pool-1',
  status: members.length ? 'MATCHED' : 'OPEN',
  capacity: 3,
  occupiedSeats: members.reduce((a, m) => a + m.seats, 0),
  members,
  ...over,
});

const nusrat = p('nusrat', 'BANANI', 'MOHAKHALI');
const rafiq = p('rafiq', 'BANANI', 'GULSHAN');

describe('demo scenario (pure engine)', () => {
  it('Rafiq joins Nusrat: MATCHED via Banani → Gulshan1 → Mohakhali with every reason code', () => {
    const d = evaluateCandidate(pool([nusrat]), rafiq, ctx);
    expect(d.decision).toBe('MATCHED');
    expect(d.route).toEqual(['BANANI', 'GULSHAN', 'MOHAKHALI']);
    expect(d.detourKm).toBe(1.1);
    expect(d.reasonCodes).toEqual(['POOL_JOINABLE', 'CAPACITY_AVAILABLE', 'PICKUP_COMPATIBLE', 'DESTINATION_COMPATIBLE', 'STOP_LIMIT_SATISFIED', 'DETOUR_WITHIN_LIMIT']);
    expect(d.capacity).toEqual({ total: 3, before: 1, requested: 1, after: 2, available: 2 });
    // The rejected alternative order is part of the explanation.
    expect(d.alternatives.some((a) => a.route.join('>') === 'BANANI>MOHAKHALI>GULSHAN' && a.violations.includes('DETOUR_TOO_HIGH'))).toBe(true);
  });

  it('Shirin (2 seats) is REJECTED with CAPACITY_EXCEEDED even though the route is perfect', () => {
    const full = pool([nusrat, rafiq]);
    const d = evaluateCandidate(full, p('shirin', 'BANANI', 'MOHAKHALI', 2), ctx);
    expect(d.decision).toBe('REJECTED');
    expect(d.reasonCodes).toEqual(['CAPACITY_EXCEEDED']);
    expect(d.capacity).toEqual({ total: 3, before: 2, requested: 2, after: 2, available: 1 });
    // Every OTHER rule passed: the route itself would have been fine.
    expect(d.checks.filter((c) => c.rule !== 'CAPACITY').every((c) => c.passed)).toBe(true);
    expect(d.route).toBeUndefined();
  });

  it('prefers pooling into Nusrat’s pool over an empty vehicle (incremental vehicle-km)', () => {
    const pooled = evaluateCandidate(pool([nusrat], { id: 'a-pooled' }), rafiq, ctx);
    const empty = evaluateCandidate(pool([], { id: 'b-empty' }), rafiq, ctx);
    expect(pooled.score!).toBeLessThan(empty.score!);
    expect(rankDecisions([empty, pooled])[0].poolId).toBe('a-pooled');
  });
});

describe('hard constraints', () => {
  it('capacity counts seats, not passengers', () => {
    expect(evaluateCandidate(pool([p('a', 'BANANI', 'MOHAKHALI', 2)]), p('b', 'BANANI', 'MOHAKHALI', 1), ctx).decision).toBe('MATCHED');
    expect(evaluateCandidate(pool([p('a', 'BANANI', 'MOHAKHALI', 2)]), p('b', 'BANANI', 'MOHAKHALI', 2), ctx).reasonCodes).toContain('CAPACITY_EXCEEDED');
  });

  it.each([
    ['STARTED', 'POOL_ALREADY_STARTED'],
    ['COMPLETED', 'POOL_ALREADY_STARTED'],
    ['CANCELLED', 'POOL_CANCELLED'],
    ['DRIVER_ARRIVED', 'LATE_JOIN_NOT_ALLOWED'],
  ] as const)('rejects joining a %s pool with %s', (status, code) => {
    const d = evaluateCandidate(pool([nusrat], { status }), rafiq, ctx);
    expect(d.decision).toBe('REJECTED');
    expect(d.reasonCodes).toContain(code);
  });

  it('allows late join after DRIVER_ARRIVED only when explicitly enabled', () => {
    const lenient = { ...ctx, rules: { ...ctx.rules, allowLateJoin: true } };
    expect(evaluateCandidate(pool([nusrat], { status: 'DRIVER_ARRIVED' }), rafiq, lenient).decision).toBe('MATCHED');
  });

  it('rejects a pickup more than 1 hop away (route reversal)', () => {
    const d = evaluateCandidate(pool([nusrat]), p('rev', 'MOHAKHALI', 'BANANI'), ctx);
    expect(d.reasonCodes).toContain('PICKUP_TOO_FAR');
  });

  it('rejects destinations more than 2 hops apart', () => {
    const d = evaluateCandidate(pool([nusrat]), p('far', 'BANANI', 'UTTARA'), ctx);
    expect(d.reasonCodes).toContain('DESTINATION_TOO_FAR');
  });

  it('three individually compatible passengers can be collectively incompatible (detour)', () => {
    // Found by searching the zone graph: every pair shares fine, all three can't without over-detouring someone.
    const a = p('a', 'BANANI', 'AZIMPUR');
    const b = p('b', 'BANANI', 'MOTIJHEEL');
    const c = p('c', 'GULSHAN', 'AZIMPUR');
    expect(evaluateCandidate(pool([a]), b, ctx).decision).toBe('MATCHED');
    expect(evaluateCandidate(pool([a]), c, ctx).decision).toBe('MATCHED');
    expect(evaluateCandidate(pool([b]), c, ctx).decision).toBe('MATCHED');
    const all = evaluateCandidate(pool([a, b]), c, ctx);
    expect(all.decision).toBe('REJECTED');
    expect(all.reasonCodes).toEqual(['DETOUR_TOO_HIGH']);
  });

  it('three individually compatible passengers can be collectively incompatible (stops)', () => {
    const a = p('a', 'BANANI', 'GULSHAN');
    const b = p('b', 'BANANI', 'MOHAKHALI');
    const c = p('c', 'UTTARA', 'FARMGATE');
    expect(evaluateCandidate(pool([a]), c, ctx).decision).toBe('MATCHED');
    expect(evaluateCandidate(pool([b]), c, ctx).decision).toBe('MATCHED');
    expect(evaluateCandidate(pool([a, b]), c, ctx).reasonCodes).toContain('MAX_STOPS_EXCEEDED');
  });

  it('reports ALL failed rules, not just the first', () => {
    const d = evaluateCandidate(pool([nusrat, rafiq], { status: 'STARTED' }), p('x', 'MOHAKHALI', 'UTTARA', 2), ctx);
    expect(d.reasonCodes).toEqual(expect.arrayContaining(['POOL_ALREADY_STARTED', 'CAPACITY_EXCEEDED', 'PICKUP_TOO_FAR', 'DESTINATION_TOO_FAR']));
  });

  it('an empty pool accepts any single passenger that fits', () => {
    const d = evaluateCandidate(pool([]), p('solo', 'UTTARA', 'MOTIJHEEL'), ctx);
    expect(d.decision).toBe('MATCHED');
    expect(d.detourKm).toBe(0);
  });

  it('is deterministic for identical inputs', () => {
    expect(evaluateCandidate(pool([nusrat]), rafiq, ctx)).toEqual(evaluateCandidate(pool([nusrat]), rafiq, ctx));
  });
});

describe('waiting before pickup counts as detour', () => {
  it('never "pools" by dropping one rider and driving back for the next (zero shared km, a long wait)', () => {
    // Before this rule the engine accepted Banani → Gulshan 1 → Banani → Mirpur: 0 km in-vehicle detour
    // for the Mirpur rider, who waited while the vehicle did a 5 km round trip.
    const d = evaluateCandidate(pool([p('a', 'BANANI', 'GULSHAN')]), p('c', 'BANANI', 'MIRPUR'), ctx);
    expect(d.decision).toBe('REJECTED');
    const serial = d.alternatives.find((x) => x.route.join('>') === 'BANANI>GULSHAN>BANANI>MIRPUR')!;
    expect(serial.violations).toContain('DETOUR_TOO_HIGH');
    expect(serial.maxDetourKm).toBe(5);
  });

  it('a later pickup on the way is not a wait: Rafiq picked up at Gulshan after Nusrat at Banani', () => {
    const d = evaluateCandidate(pool([nusrat]), p('x', 'GULSHAN', 'MOHAKHALI'), ctx);
    expect(d.decision).toBe('MATCHED');
    expect(d.passengers!.find((l) => l.rideRequestId === 'x')!.detourKm).toBe(0);
  });
});

describe('per-rider urgency (URGENT / STANDARD / FLEXIBLE)', () => {
  const urgentNusrat: PlannedPassenger = { ...nusrat, flexibility: 'URGENT' };
  const flexibleRafiq: PlannedPassenger = { ...rafiq, flexibility: 'FLEXIBLE' };

  it('urgent Nusrat + flexible Rafiq: the route goes to Mohakhali first (Banani → Mohakhali → Gulshan 1)', () => {
    const d = evaluateCandidate(pool([urgentNusrat]), flexibleRafiq, ctx);
    expect(d.decision).toBe('MATCHED');
    expect(d.route).toEqual(['BANANI', 'MOHAKHALI', 'GULSHAN']);
    const legs = Object.fromEntries(d.passengers!.map((l) => [l.rideRequestId, l]));
    expect(legs.nusrat).toMatchObject({ flexibility: 'URGENT', detourKm: 0, allowedDetourKm: 0.5 });
    expect(legs.rafiq).toMatchObject({ flexibility: 'FLEXIBLE', detourKm: 2.9, allowedDetourKm: 3 });
    // The usual order is shown as rejected: it would detour urgent Nusrat by 1.1 km.
    expect(d.alternatives.some((a) => a.route.join('>') === 'BANANI>GULSHAN>MOHAKHALI' && a.violations.includes('DETOUR_TOO_HIGH'))).toBe(true);
    expect(d.checks.find((c) => c.rule === 'DETOUR')!.message).toMatch(/urgent rider's trip almost direct/);
  });

  it('urgent Nusrat + standard Rafiq: no order fits both, so Rafiq is NOT squeezed in (his 2.9 km detour would break his own limit)', () => {
    const d = evaluateCandidate(pool([urgentNusrat]), rafiq, ctx);
    expect(d.decision).toBe('REJECTED');
    expect(d.reasonCodes).toEqual(['DETOUR_TOO_HIGH']);
    expect(d.headline).toMatch(/urgent rider needs an almost direct route/);
  });

  it('works the same way round: an urgent newcomer never lengthens an existing rider’s trip beyond their limit', () => {
    const d = evaluateCandidate(pool([rafiq]), urgentNusrat, ctx);
    expect(d.decision).toBe('REJECTED');
    const ok = evaluateCandidate(pool([flexibleRafiq]), urgentNusrat, ctx);
    expect(ok.route).toEqual(['BANANI', 'MOHAKHALI', 'GULSHAN']);
  });

  it('standard riders keep today’s behaviour (default flexibility is STANDARD)', () => {
    const d = evaluateCandidate(pool([{ ...nusrat, flexibility: 'STANDARD' }]), rafiq, ctx);
    expect(d.route).toEqual(['BANANI', 'GULSHAN', 'MOHAKHALI']);
    expect(d.passengers!.every((l) => l.flexibility === 'STANDARD')).toBe(true);
  });

  it('a flexible rider alone doesn’t change the best route: flexibility widens what fits, the score still picks the shortest', () => {
    const d = evaluateCandidate(pool([nusrat]), flexibleRafiq, ctx);
    expect(d.route).toEqual(['BANANI', 'GULSHAN', 'MOHAKHALI']);
  });
});
