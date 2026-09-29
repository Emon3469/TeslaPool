import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import '../express-augment';
import { logger } from '../logger';
import { httpLatency } from '../metrics';
import { requestContext } from '../request-context';

// Accept a caller-supplied X-Request-ID only if it is short and log-safe (prevents log injection).
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const entry = {
      event: 'HTTP_REQUEST',
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      userId: req.auth?.userId,
    };
    httpLatency.record(entry.durationMs);
    if (res.statusCode >= 500) logger.error('http.request', entry);
    else if (res.statusCode >= 400) logger.warn('http.request', entry);
    else logger.http('http.request', entry);
  });

  requestContext.run({ requestId }, () => next());
}
