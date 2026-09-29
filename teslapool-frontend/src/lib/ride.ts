import type { RidePhase, RideStatus } from './types';

/** The passenger-facing progress steps, in order. */
export const RIDE_STEPS: { status: RideStatus; label: string; hint: string }[] = [
  { status: 'REQUESTED', label: 'Requested', hint: 'Finding a compatible pool' },
  { status: 'MATCHED', label: 'Matched', hint: 'Your driver is on the way' },
  { status: 'DRIVER_ARRIVED', label: 'Driver arrived', hint: 'Meet your driver at pickup' },
  { status: 'STARTED', label: 'On the way', hint: 'Sit back, you are pooling' },
  { status: 'COMPLETED', label: 'Completed', hint: 'Fare settled' },
];

export function stepIndex(status: RideStatus): number {
  return RIDE_STEPS.findIndex((s) => s.status === status);
}

export const ACTIVE_STATUSES: RideStatus[] = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

export const isActive = (status: RideStatus) => ACTIVE_STATUSES.includes(status);

/** The API allows cancelling from REQUESTED, MATCHED or DRIVER_ARRIVED. */
export const canCancel = (status: RideStatus) => status === 'REQUESTED' || status === 'MATCHED' || status === 'DRIVER_ARRIVED';

/** Leaving a pool is allowed before the driver arrives; the ride goes back to REQUESTED. */
export const canLeavePool = (status: RideStatus) => status === 'MATCHED';

/** The driver's next lifecycle action for a passenger in this ride status. */
export function nextDriverAction(status: string): { action: 'arrive' | 'start' | 'complete'; label: string } | null {
  switch (status) {
    case 'MATCHED':
      return { action: 'arrive', label: 'Arrived at pickup' };
    case 'DRIVER_ARRIVED':
      return { action: 'start', label: 'Start trip' };
    case 'STARTED':
      return { action: 'complete', label: 'Complete trip' };
    default:
      return null;
  }
}

/** Poll while the ride can still change; stop once it reaches a terminal state. */
export function pollInterval(phase: RidePhase | undefined): number {
  return phase === 'WAITING' || phase === 'MATCHED' || phase === 'IN_PROGRESS' ? 4000 : 0;
}

/**
 * Same order the API uses for pool candidates: pools that can take you first, then the lowest
 * route score (the score is a cost, so lower is better), then pool id for a stable order.
 */
export function rankDecisions<T extends { decision: 'MATCHED' | 'REJECTED'; score?: number | null; poolId: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      Number(b.decision === 'MATCHED') - Number(a.decision === 'MATCHED') ||
      (a.score ?? Infinity) - (b.score ?? Infinity) ||
      a.poolId.localeCompare(b.poolId),
  );
}
