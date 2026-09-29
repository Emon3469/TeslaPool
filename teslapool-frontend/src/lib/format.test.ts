import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, firstName, formatBdt, formatWait, initials, percent, routeLabel, titleCase, zoneName } from './format';

describe('formatBdt', () => {
  it('formats integer poysha exactly', () => {
    expect(formatBdt(12650)).toBe('৳126.50');
    expect(formatBdt(7969)).toBe('৳79.69');
    expect(formatBdt(5)).toBe('৳0.05');
    expect(formatBdt(0)).toBe('৳0.00');
  });

  it('groups thousands and keeps the sign', () => {
    expect(formatBdt(123456789)).toBe('৳1,234,567.89');
    expect(formatBdt(-10893)).toBe('-৳108.93');
  });
});

describe('divRoundHalfUp', () => {
  it('rounds .5 up and everything else to nearest', () => {
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(20, 10)).toBe(2);
  });
});

describe('zones and labels', () => {
  const zones = [{ code: 'GULSHAN', name: 'Gulshan 1', center: { lat: 0, lng: 0 }, neighbours: [] }];

  it('prefers /meta names, then a fallback, then title case', () => {
    expect(zoneName('GULSHAN', zones)).toBe('Gulshan 1');
    expect(zoneName('BASHUNDHARA_RA')).toBe('Bashundhara R/A');
    expect(zoneName('NEW_ZONE')).toBe('New Zone');
  });

  it('joins routes with arrows', () => {
    expect(routeLabel(['BANANI', 'GULSHAN', 'MOHAKHALI'], zones)).toBe('Banani → Gulshan 1 → Mohakhali');
  });

  it('title-cases enum codes', () => {
    expect(titleCase('MORNING_PEAK')).toBe('Morning Peak');
  });
});

describe('small helpers', () => {
  it('percent', () => {
    expect(percent(0.6667)).toBe('67%');
    expect(percent(0.1946, 1)).toBe('19.5%');
    expect(percent(null)).toBe('—');
  });

  it('names', () => {
    expect(firstName('  Nusrat Jahan ')).toBe('Nusrat');
    expect(initials('Jashim Uddin')).toBe('JU');
    expect(initials('Ops')).toBe('O');
  });

  it('formatWait', () => {
    expect(formatWait(47)).toBe('47s');
    expect(formatWait(125)).toBe('2 min');
    expect(formatWait(4 * 3600 + 48 * 60)).toBe('4 h 48 min');
  });
});
