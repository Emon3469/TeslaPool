import { canPoolTransition, derivePoolStatus, joinBlockReason } from '../../src/pools/pool-state';
import { assertTransition, canTransition, InvalidTransition, RIDE_STATUSES, RideStatus } from '../../src/rides/ride-state-machine';

describe('ride state machine', () => {
  const allowed: Array<[RideStatus, RideStatus]> = [
    ['REQUESTED', 'MATCHED'],
    ['REQUESTED', 'CANCELLED'],
    ['MATCHED', 'DRIVER_ARRIVED'],
    ['MATCHED', 'CANCELLED'],
    ['MATCHED', 'REQUESTED'],
    ['DRIVER_ARRIVED', 'STARTED'],
    ['DRIVER_ARRIVED', 'CANCELLED'],
    ['STARTED', 'COMPLETED'],
  ];

  it('allows exactly the documented transitions (exhaustive over all 36 pairs)', () => {
    for (const from of RIDE_STATUSES) for (const to of RIDE_STATUSES) {
      const expected = allowed.some(([f, t]) => f === from && t === to);
      expect([from, to, canTransition(from, to)]).toEqual([from, to, expected]);
    }
  });

  it('REQUESTED → STARTED fails with a structured error', () => {
    expect(() => assertTransition('REQUESTED', 'STARTED')).toThrow(InvalidTransition);
    try {
      assertTransition('REQUESTED', 'STARTED');
    } catch (e) {
      expect(e).toMatchObject({ from: 'REQUESTED', to: 'STARTED' });
    }
  });

  it('cannot cancel once STARTED, nor leave terminal states', () => {
    expect(canTransition('STARTED', 'CANCELLED')).toBe(false);
    for (const to of RIDE_STATUSES) {
      expect(canTransition('COMPLETED', to)).toBe(false);
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });
});

describe('pool status is derived from member rides', () => {
  it.each([
    ['MATCHED', [], 'OPEN'],
    ['OPEN', ['MATCHED'], 'MATCHED'],
    ['MATCHED', ['MATCHED', 'DRIVER_ARRIVED'], 'DRIVER_ARRIVED'],
    ['DRIVER_ARRIVED', ['STARTED', 'MATCHED'], 'STARTED'],
    ['STARTED', ['COMPLETED', 'MATCHED'], 'STARTED'],
    ['STARTED', ['COMPLETED', 'COMPLETED'], 'COMPLETED'],
    ['DRIVER_ARRIVED', ['MATCHED'], 'MATCHED'],
    ['CANCELLED', [], 'CANCELLED'],
  ] as const)('%s with %j -> %s', (current, members, expected) => {
    expect(derivePoolStatus(current, [...members])).toBe(expected);
    expect(canPoolTransition(current, expected)).toBe(true);
  });

  it('never moves backwards out of STARTED or terminal states', () => {
    expect(canPoolTransition('STARTED', 'MATCHED')).toBe(false);
    expect(canPoolTransition('COMPLETED', 'OPEN')).toBe(false);
    expect(canPoolTransition('CANCELLED', 'OPEN')).toBe(false);
  });

  it('join policy by pool status', () => {
    expect(joinBlockReason('OPEN', false)).toBeNull();
    expect(joinBlockReason('MATCHED', false)).toBeNull();
    expect(joinBlockReason('DRIVER_ARRIVED', false)).toBe('LATE_JOIN_NOT_ALLOWED');
    expect(joinBlockReason('DRIVER_ARRIVED', true)).toBeNull();
    expect(joinBlockReason('STARTED', true)).toBe('POOL_ALREADY_STARTED');
  });
});
