import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config/env';
import { AppError, ErrorCode } from './errors';
import { logger } from './logger';

export type Tx = Prisma.TransactionClient;

export function createPrismaClient(url = config.databaseUrl): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } }, log: [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }] });
}

/**
 * Thrown inside a transaction when the lock-ordering protocol detects that state
 * changed between an unlocked read and acquiring the lock; the transaction is re-run.
 */
export class LockOrderRetry extends Error {
  constructor() {
    super('state changed while acquiring locks');
  }
}

/** Errors worth retrying: the whole transaction is rolled back and can safely run again. */
function isRetryable(err: unknown): boolean {
  if (err instanceof LockOrderRetry) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2034') return true; // write conflict / deadlock
    const pgCode = (err.meta as { code?: string } | undefined)?.code;
    return pgCode === '40001' || pgCode === '40P01';
  }
  const msg = err instanceof Error ? err.message : '';
  return /deadlock detected|could not serialize access/i.test(msg);
}

/**
 * Run `fn` in an interactive READ COMMITTED transaction. Correctness comes from
 * explicit row locks (SELECT ... FOR UPDATE) taken inside `fn`, always in the order
 * pool -> ride request, so concurrent requests serialise instead of racing.
 * Deadlock/serialization failures are retried a bounded number of times.
 */
export async function withTransaction<T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { timeout: config.db.txTimeoutMs, maxWait: config.db.txMaxWaitMs });
    } catch (err) {
      if (attempt < attempts && isRetryable(err)) {
        logger.warn('db.transaction_retry', { attempt, reason: (err as Error).message.slice(0, 120) });
        continue;
      }
      if (isRetryable(err)) {
        throw new AppError(409, ErrorCode.CONCURRENT_UPDATE, 'The resource was modified concurrently. Please retry.');
      }
      throw err;
    }
  }
}

/** True when `err` is a unique-constraint violation, optionally on a specific index/constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    // Violations of partial unique indexes raised from raw SQL arrive as unknown request errors.
    const msg = err instanceof Error ? err.message : '';
    return /unique constraint|duplicate key/i.test(msg) && (!constraint || msg.includes(constraint));
  }
  if (!constraint) return true;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return JSON.stringify(target ?? '').includes(constraint) || err.message.includes(constraint);
}

/** The pool_memberships_capacity_guard trigger refused an overbooking write. */
export function isCapacityGuardViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes('TESLAPOOL_CAPACITY_GUARD');
}

// Row locks. Parameterised tagged templates only; never string-built SQL.
export async function lockPool(tx: Tx, poolId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM pools WHERE id = ${poolId}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export async function lockRide(tx: Tx, rideId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ride_requests WHERE id = ${rideId}::uuid FOR UPDATE`;
  return rows.length === 1;
}
