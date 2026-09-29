import { ZoneGraphDistanceProvider } from '../../src/geography/distance-provider';
import { DISTANCE_SOURCE, dhakaZoneGraph } from '../../src/geography/zone-graph';
import { normalizeZone, ZONES } from '../../src/geography/zones';

describe('zone graph (ZONE_GRAPH_DISTANCE, not GPS)', () => {
  const g = dhakaZoneGraph;

  it('matches the spec hop counts', () => {
    expect(g.hops('BANANI', 'GULSHAN')).toBe(1);
    expect(g.hops('GULSHAN', 'MOHAKHALI')).toBe(1);
    expect(g.hops('BANANI', 'MOHAKHALI')).toBe(2);
  });

  it('uses the spec distance ranges', () => {
    expect(g.distanceKm('BANANI', 'MOHAKHALI')).toBeGreaterThanOrEqual(3);
    expect(g.distanceKm('BANANI', 'MOHAKHALI')).toBeLessThanOrEqual(4);
    expect(g.distanceKm('BANANI', 'GULSHAN')).toBeGreaterThanOrEqual(2.5);
    expect(g.distanceKm('BANANI', 'GULSHAN')).toBeLessThanOrEqual(3.5);
    expect(g.distanceKm('MOHAKHALI', 'GULSHAN')).toBeGreaterThanOrEqual(2);
    expect(g.distanceKm('MOHAKHALI', 'GULSHAN')).toBeLessThanOrEqual(2.5);
  });

  it('prefers the direct Banani-Mohakhali road over the Gulshan detour for distance, but not for hops', () => {
    expect(g.distanceKm('BANANI', 'MOHAKHALI')).toBe(3.4);
    expect(g.distanceKm('BANANI', 'GULSHAN') + g.distanceKm('GULSHAN', 'MOHAKHALI')).toBe(4.5);
  });

  it('is connected, symmetric and zero on the diagonal', () => {
    for (const a of ZONES) {
      expect(g.distanceKm(a, a)).toBe(0);
      expect(g.hops(a, a)).toBe(0);
      for (const b of ZONES) {
        expect(Number.isFinite(g.distanceKm(a, b))).toBe(true);
        expect(Number.isFinite(g.hops(a, b))).toBe(true);
        expect(g.distanceKm(a, b)).toBe(g.distanceKm(b, a));
      }
    }
  });

  it('satisfies the triangle inequality (so removing a stop can never lengthen a ride)', () => {
    for (const a of ZONES) for (const b of ZONES) for (const c of ZONES) {
      expect(g.distanceKm(a, c)).toBeLessThanOrEqual(g.distanceKm(a, b) + g.distanceKm(b, c) + 1e-9);
    }
  });

  it('labels its distances as zone-graph approximations', () => {
    expect(new ZoneGraphDistanceProvider().source).toBe(DISTANCE_SOURCE.ZONE_GRAPH);
    expect(DISTANCE_SOURCE.ZONE_GRAPH).not.toBe(DISTANCE_SOURCE.REAL_ROUTE);
  });
});

describe('normalizeZone', () => {
  it.each([
    ['Banani', 'BANANI'],
    ['Gulshan1', 'GULSHAN'],
    ['gulshan-1', 'GULSHAN'],
    ['GULSHAN', 'GULSHAN'],
    ['Bashundhara R/A', 'BASHUNDHARA_RA'],
    ['  mohakhali ', 'MOHAKHALI'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeZone(input)).toBe(expected);
  });

  it.each(['Mars', '', 'Gulshan9', 'DROP TABLE users'])('rejects %p', (input) => {
    expect(normalizeZone(input)).toBeNull();
  });
});
