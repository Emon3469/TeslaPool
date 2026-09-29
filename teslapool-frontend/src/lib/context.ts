/**
 * Trip conditions the API assumes when a ride request leaves them out (mirrors the API's
 * `timeOfDayAt` / `typicalTraffic`): Dhaka local time (UTC+6), typical traffic for that time,
 * clear weather. Used to price the live preview exactly like the real request will be.
 */
export type TimeOfDay = 'MORNING_PEAK' | 'EVENING_PEAK' | 'OFF_PEAK' | 'NIGHT';
export type Traffic = 'LOW' | 'MEDIUM' | 'HIGH' | 'GRIDLOCK';
export type Weather = 'CLEAR' | 'OVERCAST' | 'RAINY';

export function dhakaTimeOfDay(date: Date): TimeOfDay {
  const hour = (date.getUTCHours() + 6) % 24;
  if (hour >= 7 && hour < 11) return 'MORNING_PEAK';
  if (hour >= 17 && hour < 21) return 'EVENING_PEAK';
  if (hour >= 22 || hour < 6) return 'NIGHT';
  return 'OFF_PEAK';
}

export function typicalTraffic(t: TimeOfDay): Traffic {
  return t === 'MORNING_PEAK' || t === 'EVENING_PEAK' ? 'HIGH' : t === 'OFF_PEAK' ? 'MEDIUM' : 'LOW';
}

export function resolveContext(ctx: { traffic?: string; weather?: string; timeOfDay?: string }, now = new Date()) {
  const timeOfDay = (ctx.timeOfDay as TimeOfDay | undefined) ?? dhakaTimeOfDay(now);
  return {
    timeOfDay,
    traffic: (ctx.traffic as Traffic | undefined) ?? typicalTraffic(timeOfDay),
    weather: (ctx.weather as Weather | undefined) ?? 'CLEAR',
  };
}
