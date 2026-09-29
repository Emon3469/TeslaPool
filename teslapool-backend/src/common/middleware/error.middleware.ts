import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config/env';
import { InvalidTransition } from '../../rides/ride-state-machine';
import { AppError, ErrorCode, ErrorCodeValue } from '../errors';
import { logger } from '../logger';
import { counters } from '../metrics';
import { currentRequestId } from '../request-context';

function send(res: Response, status: number, code: ErrorCodeValue | string, message: string, details?: Record<string, unknown>) {
  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}), requestId: currentRequestId() },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  send(res, 404, ErrorCode.NOT_FOUND, `No route for ${req.method} ${req.path}.`);
}

/**
 * Converts every failure into the standard error envelope. Stack traces, SQL,
 * Prisma internals and secrets never reach the client; unexpected errors are
 * logged in full server-side under the same requestId.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    logger.error('http.error_after_headers_sent', { error: (err as Error)?.message });
    return;
  }
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error('http.app_error', { code: err.code, message: err.message });
    return send(res, err.status, err.code, err.message, err.details);
  }
  if (err instanceof InvalidTransition) {
    counters.invalidTransitionsRejected++;
    return send(res, 409, ErrorCode.INVALID_STATE_TRANSITION, err.message, { from: err.from, to: err.to });
  }

  // body-parser failures
  const type = (err as { type?: string })?.type;
  if (type === 'entity.parse.failed') return send(res, 400, ErrorCode.MALFORMED_JSON, 'Request body is not valid JSON.');
  if (type === 'entity.too.large') return send(res, 413, ErrorCode.PAYLOAD_TOO_LARGE, 'Request body is too large.');

  if (err instanceof Prisma.PrismaClientInitializationError || (err instanceof Prisma.PrismaClientKnownRequestError && ['P1001', 'P1002', 'P1017', 'P2024'].includes(err.code))) {
    logger.error('db.unavailable', { error: (err as Error).message });
    return send(res, 503, ErrorCode.SERVICE_UNAVAILABLE, 'The service is temporarily unavailable. Please retry shortly.');
  }

  const e = err instanceof Error ? err : new Error(String(err));
  logger.error('http.unhandled_error', { error: e.message, name: e.name, stack: e.stack });
  send(res, 500, ErrorCode.INTERNAL_ERROR, config.isProduction ? 'An unexpected error occurred.' : `Unexpected error: ${e.message}`);
}
