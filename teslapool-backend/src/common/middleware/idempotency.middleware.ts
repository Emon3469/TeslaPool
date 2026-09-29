import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import '../express-augment';
import { isUniqueViolation } from '../db';
import { AppError, ErrorCode } from '../errors';
import { logger } from '../logger';

const KEY_FORMAT = /^[A-Za-z0-9._:-]{1,128}$/;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Idempotency-Key support for mutations (Stripe-style), scoped per user:
 *  - first request claims the key (row IN_PROGRESS, unique on user+key), runs, stores the response;
 *  - a replay with the same key and same payload gets the stored response (Idempotent-Replayed: true);
 *  - the same key with a DIFFERENT payload is rejected (422), never silently reused;
 *  - a replay while the first is still running gets 409, not a second execution;
 *  - 5xx responses release the key so the client can retry.
 * Must be mounted after `authenticate`.
 */
export function idempotency(prisma: PrismaClient, ttlHours: number): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header('idempotency-key');
    if (key === undefined) return next();
    if (!KEY_FORMAT.test(key)) {
      return next(new AppError(400, ErrorCode.IDEMPOTENCY_KEY_INVALID, 'Idempotency-Key must be 1-128 characters of [A-Za-z0-9._:-].'));
    }
    const userId = req.auth!.userId;
    const path = req.originalUrl.split('?')[0].slice(0, 255);
    const requestHash = createHash('sha256').update(`${req.method} ${path} ${stableStringify(req.body ?? null)}`).digest('hex');

    try {
      await prisma.idempotencyKey.deleteMany({ where: { userId, key, expiresAt: { lt: new Date() } } });
      const record = await prisma.idempotencyKey.create({
        data: { userId, key, method: req.method, path, requestHash, expiresAt: new Date(Date.now() + ttlHours * 3_600_000) },
      });

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        const status = res.statusCode;
        const persist =
          status >= 500
            ? prisma.idempotencyKey.delete({ where: { id: record.id } })
            : prisma.idempotencyKey.update({
                where: { id: record.id },
                data: { status: 'COMPLETED', responseStatus: status, responseBody: body as Prisma.InputJsonValue },
              });
        persist.catch((err) => logger.error('idempotency.persist_failed', { key, error: (err as Error).message }));
        return originalJson(body);
      };
      return next();
    } catch (err) {
      if (!isUniqueViolation(err)) return next(err);
    }

    try {
      const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (!existing) return next(new AppError(409, ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS, 'Request with this Idempotency-Key is being processed.'));
      if (existing.requestHash !== requestHash) {
        return next(new AppError(422, ErrorCode.IDEMPOTENCY_KEY_REUSED, 'This Idempotency-Key was already used with a different request.'));
      }
      if (existing.status === 'IN_PROGRESS') {
        return next(new AppError(409, ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS, 'Request with this Idempotency-Key is being processed.'));
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.responseStatus ?? 200).json(existing.responseBody);
    } catch (err) {
      next(err);
    }
  };
}
