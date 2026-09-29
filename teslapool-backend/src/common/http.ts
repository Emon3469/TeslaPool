import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { currentRequestId } from './request-context';

/** Success envelope: { success: true, data, meta: { requestId, ...pagination } } */
export function sendOk<T>(res: Response, data: T, status = 200, meta: Record<string, unknown> = {}): void {
  res.status(status).json({ success: true, data, meta: { requestId: currentRequestId(), ...meta } });
}

export interface Page {
  page: number;
  limit: number;
  skip: number;
}

export function pageMeta(page: Page, total: number) {
  return { page: page.page, limit: page.limit, total, totalPages: Math.max(1, Math.ceil(total / page.limit)) };
}

/** Wrap async handlers so rejections reach the error middleware. */
export function asyncHandler<Req extends Request = Request>(fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}
