import { ZoneGraphDistanceProvider } from '../../src/geography/distance-provider';
import { allowedDetourKm, enumeratePlans, PlannedPassenger } from '../../src/route-engine/route-planner';

const distance = new ZoneGraphDistanceProvider();
const rules = { maxDetourKm: 1.5, maxDetourRatio: 0.3, maxStops: 4 };
const p = (id: string, pickupZone: PlannedPassenger['pickupZone'], dropoffZone: PlannedPassenger['dropoffZone'], seats = 1): PlannedPassenger => ({ rideRequestId: id, pickupZone, dropoffZone, seats });

const nusrat = p('nusrat', 'BANANI', 'MOHAKHALI');
const rafiq = p('rafiq', 'BANANI', 'GULSHAN');

describe('allowed detour policy: max(MAX_DETOUR_KM, MAX_DETOUR_RATIO x solo)', () => {
  it('uses the 1.5 km floor for short trips', () => expect(allowedDetourKm(3.4, rules)).toBe(1.5));
  it('uses 30% for long trips', () => expect(allowedDetourKm(10, rules)).toBeCloseTo(3));
});

describe('route planner', () => {
  const plans = enumeratePlans([nusrat, rafiq], rules, distance);
  const byRoute = (route: string) => plans.find((pl) => pl.zones.join('>') === route)!;

  it('only generates orders with pickup before dropoff, merging same-zone stops', () => {
    for (const plan of plans) {
      for (const leg of plan.passengers) expect(leg.dropoffSequence).toBeGreaterThan(leg.pickupSequence);
      for (let i = 1; i < plan.stops.length; i++) expect(plan.stops[i].zone).not.toBe(plan.stops[i - 1].zone);
    }
    expect(byRoute('BANANI>GULSHAN>MOHAKHALI')).toBeDefined();
    expect(byRoute('BANANI>MOHAKHALI>GULSHAN')).toBeDefined();
  });

  it('Banani → Gulshan1 → Mohakhali is feasible: Nusrat detours 1.1 km (≤ 1.5), Rafiq 0', () => {
    const plan = byRoute('BANANI>GULSHAN>MOHAKHALI');
    expect(plan.feasible).toBe(true);
    expect(plan.totalDistanceKm).toBe(4.5);
    expect(plan.stopCount).toBe(3);
    const n = plan.passengers.find((l) => l.rideRequestId === 'nusrat')!;
    const r = plan.passengers.find((l) => l.rideRequestId === 'rafiq')!;
    expect(n.detourKm).toBe(1.1);
    expect(r.detourKm).toBe(0);
    expect(r.sharedFraction).toBe(1);
    expect(n.sharedFraction).toBeCloseTo(2.5 / 4.5, 4);
  });

  it('Banani → Mohakhali → Gulshan1 is rejected: Rafiq would detour 2.9 km', () => {
    const plan = byRoute('BANANI>MOHAKHALI>GULSHAN');
    expect(plan.feasible).toBe(false);
    expect(plan.violations).toEqual(['DETOUR_TOO_HIGH']);
    expect(plan.passengers.find((l) => l.rideRequestId === 'rafiq')!.detourKm).toBe(2.9);
  });

  it('checks EVERY passenger, not only the newcomer', () => {
    // Newcomer is Rafiq; the plan that hurts the existing passenger (Nusrat) must be caught too.
    const longDetourForNusrat = enumeratePlans([nusrat, p('x', 'BANANI', 'FARMGATE')], { ...rules, maxDetourKm: 0.5, maxDetourRatio: 0 }, distance)
      .find((pl) => pl.zones.join('>') === 'BANANI>FARMGATE>MOHAKHALI')!;
    expect(longDetourForNusrat.violations).toContain('DETOUR_TOO_HIGH');
  });

  it('flags plans exceeding MAX_STOPS', () => {
    const plansTight = enumeratePlans([nusrat, rafiq], { ...rules, maxStops: 2 }, distance);
    expect(plansTight.every((pl) => pl.violations.includes('MAX_STOPS_EXCEEDED'))).toBe(true);
  });

  it('is deterministic', () => {
    const again = enumeratePlans([nusrat, rafiq], rules, distance);
    expect(again.map((pl) => pl.zones.join('>'))).toEqual(plans.map((pl) => pl.zones.join('>')));
  });

  it('enumerates at most 90 orders for three passengers', () => {
    const three = enumeratePlans([nusrat, rafiq, p('c', 'GULSHAN', 'MOHAKHALI')], rules, distance);
    expect(three.length).toBeGreaterThan(0);
    expect(three.length).toBeLessThanOrEqual(90);
  });
});

describe('detour limit by urgency', () => {
  it('urgent: max(0.5 km, 10%); flexible: max(3 km, 60%); standard unchanged', () => {
    expect(allowedDetourKm(3.4, rules, 'URGENT')).toBe(0.5);
    expect(allowedDetourKm(10, rules, 'URGENT')).toBeCloseTo(1);
    expect(allowedDetourKm(2.5, rules, 'FLEXIBLE')).toBe(3);
    expect(allowedDetourKm(10, rules, 'FLEXIBLE')).toBeCloseTo(6);
    expect(allowedDetourKm(3.4, rules, 'STANDARD')).toBe(allowedDetourKm(3.4, rules));
  });
});
