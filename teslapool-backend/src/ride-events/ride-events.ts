import { Prisma, type PrismaClient, type RideEvent } from '@prisma/client';
import type { Tx } from '../common/db';
import { registry, z } from '../docs/openapi-registry';

/**
 * Immutable ride history. Rows are only ever INSERTed; a database trigger rejects
 * UPDATE/DELETE. Every status transition writes STATUS_CHANGED (with its cause),
 * so the full lifecycle of any ride can be replayed from this table.
 */
export const RideEventType = {
  RIDE_REQUESTED: 'RIDE_REQUESTED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  /** A co-rider's route/fare changed because someone joined or left the pool. */
  ROUTE_UPDATED: 'ROUTE_UPDATED',
  /** A match attempt was refused by the domain engine (kept as a labelled outcome for future match-quality ML). */
  MATCH_REJECTED: 'MATCH_REJECTED',
} as const;
export type RideEventTypeValue = (typeof RideEventType)[keyof typeof RideEventType];

export interface NewRideEvent {
  rideRequestId: string;
  poolId?: string | null;
  eventType: RideEventTypeValue;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

const toRow = (e: NewRideEvent): Prisma.RideEventCreateManyInput => ({
  rideRequestId: e.rideRequestId,
  poolId: e.poolId ?? null,
  eventType: e.eventType,
  fromStatus: e.fromStatus ?? null,
  toStatus: e.toStatus ?? null,
  actorId: e.actorId ?? null,
  metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
});

export async function appendRideEvents(db: Tx | PrismaClient, events: NewRideEvent[]): Promise<void> {
  if (events.length) await db.rideEvent.createMany({ data: events.map(toRow) });
}

export const RideEventDto = registry.register(
  'RideEvent',
  z.object({
    id: z.string().uuid(),
    eventType: z.string().openapi({ example: 'STATUS_CHANGED' }),
    from: z.string().nullable().openapi({ example: 'MATCHED' }),
    to: z.string().nullable().openapi({ example: 'DRIVER_ARRIVED' }),
    poolId: z.string().uuid().nullable(),
    actorId: z.string().uuid().nullable(),
    metadata: z.unknown(),
    createdAt: z.string().datetime(),
  }),
);

export const toRideEventDto = (e: RideEvent): z.infer<typeof RideEventDto> => ({
  id: e.id,
  eventType: e.eventType,
  from: e.fromStatus,
  to: e.toStatus,
  poolId: e.poolId,
  actorId: e.actorId,
  metadata: e.metadata,
  createdAt: e.createdAt.toISOString(),
});
