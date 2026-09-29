import type { RideStatus } from '../rides/ride-state-machine';

/**
 * Pool lifecycle. A pool's status is DERIVED from the statuses of its active
 * members inside the same locked transaction that changes them, so pool and ride
 * states can never disagree:
 *
 *   OPEN ──first member──► MATCHED ──driver arrives──► DRIVER_ARRIVED ──pickup──► STARTED ──all dropped──► COMPLETED
 *     ▲                       │
 *     └──last member leaves───┘   (also from DRIVER_ARRIVED if every member cancels)
 *   OPEN ──driver cancels an empty pool──► CANCELLED
 */
export const POOL_STATUSES = ['OPEN', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

export const ACTIVE_POOL_STATUSES: PoolStatus[] = ['OPEN', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

const POOL_TRANSITIONS: Record<PoolStatus, PoolStatus[]> = {
  OPEN: ['MATCHED', 'CANCELLED'],
  MATCHED: ['OPEN', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED'],
  DRIVER_ARRIVED: ['OPEN', 'MATCHED', 'STARTED', 'COMPLETED'],
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canPoolTransition(from: PoolStatus, to: PoolStatus): boolean {
  return from === to || POOL_TRANSITIONS[from].includes(to);
}

/**
 * Derive the pool status from its members' ride statuses.
 * `memberStatuses` covers ACTIVE and COMPLETED memberships (cancelled/left ones are excluded).
 */
export function derivePoolStatus(current: PoolStatus, memberStatuses: RideStatus[]): PoolStatus {
  if (current === 'CANCELLED' || current === 'COMPLETED') return current;
  if (memberStatuses.length === 0) return current === 'STARTED' ? 'COMPLETED' : 'OPEN';
  if (memberStatuses.every((s) => s === 'COMPLETED')) return 'COMPLETED';
  if (current === 'STARTED' || memberStatuses.some((s) => s === 'STARTED' || s === 'COMPLETED')) return 'STARTED';
  if (memberStatuses.some((s) => s === 'DRIVER_ARRIVED')) return 'DRIVER_ARRIVED';
  return 'MATCHED';
}

/**
 * Why a new passenger cannot join a pool in this status (null = may join).
 * Late join after DRIVER_ARRIVED is rejected unless explicitly enabled (ALLOW_LATE_JOIN).
 */
export function joinBlockReason(
  status: PoolStatus,
  allowLateJoin: boolean,
): 'POOL_ALREADY_STARTED' | 'POOL_CANCELLED' | 'LATE_JOIN_NOT_ALLOWED' | null {
  switch (status) {
    case 'OPEN':
    case 'MATCHED':
      return null;
    case 'DRIVER_ARRIVED':
      return allowLateJoin ? null : 'LATE_JOIN_NOT_ALLOWED';
    case 'STARTED':
    case 'COMPLETED':
      return 'POOL_ALREADY_STARTED';
    case 'CANCELLED':
      return 'POOL_CANCELLED';
  }
}
