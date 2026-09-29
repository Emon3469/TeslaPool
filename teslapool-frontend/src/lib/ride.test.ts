import { describe, expect, it } from 'vitest';
import { safeNext } from './navigation';
import { canCancel, canLeavePool, isActive, nextDriverAction, pollInterval, rankDecisions, RIDE_STEPS, stepIndex } from './ride';

describe('ride lifecycle helpers', () => {
  it('orders the steps like the API state machine', () => {
    expect(RIDE_STEPS.map((s) => s.status)).toEqual(['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED']);
    expect(stepIndex('DRIVER_ARRIVED')).toBe(2);
    expect(stepIndex('CANCELLED')).toBe(-1);
  });

  it('allows cancelling only before the trip starts', () => {
    expect(['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED'].every((s) => canCancel(s as never))).toBe(true);
    expect(['STARTED', 'COMPLETED', 'CANCELLED'].some((s) => canCancel(s as never))).toBe(false);
  });

  it('allows leaving a pool only while matched', () => {
    expect(canLeavePool('MATCHED')).toBe(true);
    expect(canLeavePool('DRIVER_ARRIVED')).toBe(false);
    expect(canLeavePool('REQUESTED')).toBe(false);
  });

  it('knows which statuses are active', () => {
    expect(isActive('STARTED')).toBe(true);
    expect(isActive('COMPLETED')).toBe(false);
  });

  it('gives the driver exactly one next action per status', () => {
    expect(nextDriverAction('MATCHED')?.action).toBe('arrive');
    expect(nextDriverAction('DRIVER_ARRIVED')?.action).toBe('start');
    expect(nextDriverAction('STARTED')?.action).toBe('complete');
    expect(nextDriverAction('COMPLETED')).toBeNull();
    expect(nextDriverAction('REQUESTED')).toBeNull();
  });

  it('polls only while a ride can still change', () => {
    expect(pollInterval('WAITING')).toBeGreaterThan(0);
    expect(pollInterval('IN_PROGRESS')).toBeGreaterThan(0);
    expect(pollInterval('COMPLETED')).toBe(0);
    expect(pollInterval('CANCELLED')).toBe(0);
    expect(pollInterval(undefined)).toBe(0);
  });
});

describe('safeNext (post-login redirect)', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/wallet')).toBe('/wallet');
    expect(safeNext('/rides/abc?x=1')).toBe('/rides/abc?x=1');
  });

  it('rejects open redirects and auth loops', () => {
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('/login?next=/x')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe('rankDecisions', () => {
  it('puts feasible pools first and the lowest (best) score first, like the API', () => {
    const d = (poolId: string, decision: 'MATCHED' | 'REJECTED', score: number | null) => ({ poolId, decision, score });
    const ranked = rankDecisions([d('a', 'MATCHED', 0.9), d('b', 'REJECTED', null), d('c', 'MATCHED', 0.2), d('d', 'MATCHED', null)]);
    expect(ranked.map((x) => x.poolId)).toEqual(['c', 'a', 'd', 'b']);
  });
});
