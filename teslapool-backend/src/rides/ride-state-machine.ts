/**
 * Ride request lifecycle: the only place that knows which transitions are legal.
 *
 *   REQUESTED ─► MATCHED ─► DRIVER_ARRIVED ─► STARTED ─► COMPLETED
 *       │           │  ▲          │
 *       │           │  └─(leave pool before the driver arrives: MATCHED ─► REQUESTED)
 *       ▼           ▼             ▼
 *   CANCELLED   CANCELLED     CANCELLED        (no cancellation once STARTED)
 */
export const RIDE_STATUSES = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const ACTIVE_RIDE_STATUSES: RideStatus[] = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

/**
 * The PRD's passenger-facing tracking vocabulary ("waiting → matched → in progress → completed/cancelled").
 * DRIVER_ARRIVED is still "matched" from the passenger's point of view; `status` keeps the precise state.
 */
export const RIDE_PHASES = ['WAITING', 'MATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type RidePhase = (typeof RIDE_PHASES)[number];
export const RIDE_PHASE: Record<RideStatus, RidePhase> = {
  REQUESTED: 'WAITING',
  MATCHED: 'MATCHED',
  DRIVER_ARRIVED: 'MATCHED',
  STARTED: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

const TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  REQUESTED: ['MATCHED', 'CANCELLED'],
  MATCHED: ['DRIVER_ARRIVED', 'CANCELLED', 'REQUESTED'],
  DRIVER_ARRIVED: ['STARTED', 'CANCELLED'],
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function allowedTransitions(from: RideStatus): readonly RideStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RideStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export class InvalidTransition extends Error {
  constructor(
    readonly from: RideStatus,
    readonly to: RideStatus,
  ) {
    super(
      isTerminal(from)
        ? `Ride is ${from} (terminal) and cannot become ${to}.`
        : `Ride cannot go from ${from} to ${to}. Allowed: ${TRANSITIONS[from].join(', ')}.`,
    );
  }
}

/** Throws InvalidTransition (mapped to 409 INVALID_STATE_TRANSITION) when the move is illegal. */
export function assertTransition(from: RideStatus, to: RideStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransition(from, to);
}
