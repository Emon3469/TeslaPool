import { applyDiscount, applyFareGuardrail, divRoundHalfUp, poolDiscountBps, pooledFare, soloFarePoysha } from '../../src/fares/fare-engine';

const rates = { basePoysha: 5000, perKmPoysha: 2000, perMinPoysha: 50, poolAlphaBps: 2500, maxDiscountBps: 2500, mlMaxDeviationBps: 2000, pricingMode: 'ml_guarded' as const };
const deterministic = { ...rates, pricingMode: 'deterministic' as const };

describe('integer arithmetic', () => {
  it('divRoundHalfUp rounds half up and rejects non-integers', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(7, 3)).toBe(2);
    expect(() => divRoundHalfUp(1.5, 2)).toThrow(RangeError);
    expect(() => divRoundHalfUp(-1, 2)).toThrow(RangeError);
  });
});

describe('solo fare (base + km + min), integer poysha', () => {
  it('Banani → Mohakhali, 3.4 km, 19 min = ৳50 + ৳68 + ৳9.50 = 12750 poysha', () => {
    expect(soloFarePoysha(3.4, 19, rates)).toBe(12750);
  });

  it('never produces floating-point money', () => {
    for (const km of [0.1, 0.3, 1.7, 2.35, 3.4, 9.99]) for (const min of [0.7, 3.3, 12.9, 45.5]) {
      expect(Number.isInteger(soloFarePoysha(km, min, rates))).toBe(true);
    }
  });

  it('avoids the classic float trap (0.1 + 0.2 km)', () => {
    expect(soloFarePoysha(0.1 + 0.2, 0, rates)).toBe(5000 + 600);
  });

  it('rejects negative inputs', () => {
    expect(() => soloFarePoysha(-1, 5, rates)).toThrow(RangeError);
  });
});

describe('pool discount = min(maxDiscount, alpha x sharedFraction)', () => {
  it('no sharing, no discount', () => expect(poolDiscountBps(0, rates)).toBe(0));
  it('fully shared ride gets alpha = 25%', () => expect(poolDiscountBps(1, rates)).toBe(2500));
  it('is capped at MAX_DISCOUNT', () => expect(poolDiscountBps(1, { ...rates, poolAlphaBps: 9000 })).toBe(2500));
  it('scales with shared fraction (Nusrat shares 2.5 of 4.5 km -> 13.89%)', () => expect(poolDiscountBps(2.5 / 4.5, rates)).toBe(1389));
  it('applies the discount in integers', () => {
    expect(applyDiscount(12750, 2500)).toBe(9563); // 9562.5 rounds half up
    const f = pooledFare(12750, 1, rates);
    expect(f).toMatchObject({ soloFarePoysha: 12750, discountBps: 2500, discountPercent: 25, farePoysha: 9563 });
  });
});

describe('default pricing mode: deterministic (hand-verifiable), ML advisory only', () => {
  it('always charges the baseline, but still reports what the model said and whether it would pass', () => {
    expect(applyFareGuardrail(13000, 14800, 'fare-v1', deterministic)).toMatchObject({
      pricingMode: 'deterministic', finalFarePoysha: 13000, source: 'DETERMINISTIC', reason: 'DETERMINISTIC_PRICING',
      mlPredictedFarePoysha: 14800, mlWithinGuardrail: true, guardrailApplied: false,
    });
    expect(applyFareGuardrail(13000, 24000, 'fare-v1', deterministic)).toMatchObject({ finalFarePoysha: 13000, mlWithinGuardrail: false });
    expect(applyFareGuardrail(13000, null, null, deterministic)).toMatchObject({ finalFarePoysha: 13000, mlWithinGuardrail: null, reason: 'DETERMINISTIC_PRICING' });
  });
});

describe('ml_guarded pricing mode: ML fare within ±20% of the deterministic baseline', () => {
  const baseline = 13000; // ৳130 -> allowed band ৳104..৳156

  it('computes the allowed band', () => {
    expect(applyFareGuardrail(baseline, 14800, 'fare-v1', rates).allowedBand).toEqual({ minPoysha: 10400, maxPoysha: 15600 });
  });

  it('accepts ML ৳148 (inside the band)', () => {
    const d = applyFareGuardrail(baseline, 14800, 'fare-v1', rates);
    expect(d).toMatchObject({ finalFarePoysha: 14800, source: 'ML', reason: 'ML_WITHIN_GUARDRAIL', guardrailApplied: false, modelVersion: 'fare-v1' });
  });

  it('rejects ML ৳240 and falls back to the deterministic ৳130', () => {
    const d = applyFareGuardrail(baseline, 24000, 'fare-v1', rates);
    expect(d).toMatchObject({ finalFarePoysha: 13000, source: 'DETERMINISTIC', reason: 'FARE_GUARDRAIL_TRIGGERED', guardrailApplied: true, mlPredictedFarePoysha: 24000 });
  });

  it('treats exactly 20% as inside and 20.01% as outside', () => {
    expect(applyFareGuardrail(baseline, 15600, 'fare-v1', rates).source).toBe('ML');
    expect(applyFareGuardrail(baseline, 15602, 'fare-v1', rates).source).toBe('DETERMINISTIC');
    expect(applyFareGuardrail(baseline, 10400, 'fare-v1', rates).source).toBe('ML');
    expect(applyFareGuardrail(baseline, 10399, 'fare-v1', rates).source).toBe('DETERMINISTIC');
  });

  it('falls back when ML is unavailable or nonsensical', () => {
    for (const ml of [null, 0, -500, 1.5, Number.NaN]) {
      const d = applyFareGuardrail(baseline, ml as number | null, null, rates);
      expect(d.finalFarePoysha).toBe(baseline);
      expect(d.source).toBe('DETERMINISTIC');
      expect(d.reason).toBe('ML_PREDICTION_UNAVAILABLE');
    }
  });
});
