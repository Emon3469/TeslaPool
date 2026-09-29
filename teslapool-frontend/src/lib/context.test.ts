import { describe, expect, it } from 'vitest';
import { dhakaTimeOfDay, resolveContext, typicalTraffic } from './context';

const at = (utcHour: number) => new Date(Date.UTC(2026, 8, 29, utcHour, 30));

describe('trip context defaults (Dhaka, UTC+6)', () => {
  it('classifies Dhaka local time', () => {
    expect(dhakaTimeOfDay(at(2))).toBe('MORNING_PEAK'); // 08:30 Dhaka
    expect(dhakaTimeOfDay(at(7))).toBe('OFF_PEAK'); // 13:30
    expect(dhakaTimeOfDay(at(12))).toBe('EVENING_PEAK'); // 18:30
    expect(dhakaTimeOfDay(at(22))).toBe('NIGHT'); // 04:30
  });

  it('maps time of day to typical traffic', () => {
    expect(typicalTraffic('MORNING_PEAK')).toBe('HIGH');
    expect(typicalTraffic('OFF_PEAK')).toBe('MEDIUM');
    expect(typicalTraffic('NIGHT')).toBe('LOW');
  });

  it('fills only what the rider left out', () => {
    expect(resolveContext({}, at(2))).toEqual({ timeOfDay: 'MORNING_PEAK', traffic: 'HIGH', weather: 'CLEAR' });
    expect(resolveContext({ traffic: 'GRIDLOCK', weather: 'RAINY' }, at(2))).toEqual({ timeOfDay: 'MORNING_PEAK', traffic: 'GRIDLOCK', weather: 'RAINY' });
    expect(resolveContext({ timeOfDay: 'NIGHT' }, at(2)).traffic).toBe('LOW');
  });
});
