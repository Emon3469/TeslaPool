import { describe, expect, it } from 'vitest';
import { applyDiscountBps, ratesFromMeta, standardFare, zoneDistanceKm } from './fare';

const RATES = { basePoysha: 5000, perKmPoysha: 2000, perMinPoysha: 50 };

describe('standardFare', () => {
  it('reproduces the PRD worked example for Nusrat (Banani → Mohakhali, 3.4 km, 17 min)', () => {
    expect(standardFare(3.4, 17, RATES)).toEqual({ basePoysha: 5000, distanceChargePoysha: 6800, timeChargePoysha: 850, totalPoysha: 12650 });
  });

  it('reproduces Rafiq (Banani → Gulshan, 2.5 km, 12.5 min)', () => {
    expect(standardFare(2.5, 12.5, RATES).totalPoysha).toBe(10625);
  });

  it('matches the live quote seen in the app (3.4 km, 11.2 min)', () => {
    expect(standardFare(3.4, 11.2, RATES)).toMatchObject({ distanceChargePoysha: 6800, timeChargePoysha: 560, totalPoysha: 12360 });
  });

  it('rounds half-up per metre and per second', () => {
    // 1.2345 km -> 1235 m (rounded) -> 1235 * 2000 / 1000 = 2470 poysha
    expect(standardFare(1.2345, 0, RATES).distanceChargePoysha).toBe(2470);
    // 1 second at 50 poysha/min = 0.8333 -> 1
    expect(standardFare(0, 1 / 60, RATES).timeChargePoysha).toBe(1);
  });

  it('always sums its lines exactly to the total', () => {
    for (const [km, min] of [
      [0.1, 1],
      [7.77, 33.3],
      [19.99, 118.4],
    ]) {
      const f = standardFare(km, min, RATES);
      expect(f.basePoysha + f.distanceChargePoysha + f.timeChargePoysha).toBe(f.totalPoysha);
      expect(Number.isInteger(f.totalPoysha)).toBe(true);
    }
  });
});

describe('applyDiscountBps', () => {
  it('gives the PRD pooled fares to the poysha', () => {
    expect(applyDiscountBps(12650, 1389)).toBe(10893); // Nusrat, 13.89 %
    expect(applyDiscountBps(10625, 2500)).toBe(7969); // Rafiq, 25 %
  });

  it('is the identity with no discount and never negative', () => {
    expect(applyDiscountBps(12345, 0)).toBe(12345);
    expect(applyDiscountBps(12345, 10_000)).toBe(0);
  });
});

describe('meta helpers', () => {
  const meta = {
    fare: { basePoysha: 1, perKmPoysha: 2, perMinPoysha: 3, currency: 'BDT', minorUnit: 'poysha', minorUnitsPerBdt: 100, maxPoolDiscountPercent: 25, mlMaxDeviationPercent: 20 },
    distanceKm: { BANANI: { MOHAKHALI: 3.4 } },
  } as const;

  it('extracts rates', () => {
    expect(ratesFromMeta(meta as never)).toEqual({ basePoysha: 1, perKmPoysha: 2, perMinPoysha: 3 });
  });

  it('looks distances up in either direction', () => {
    expect(zoneDistanceKm(meta as never, 'BANANI', 'MOHAKHALI')).toBe(3.4);
    expect(zoneDistanceKm(meta as never, 'MOHAKHALI', 'BANANI')).toBe(3.4);
    expect(zoneDistanceKm(meta as never, 'UTTARA', 'BANANI')).toBeNull();
  });
});
