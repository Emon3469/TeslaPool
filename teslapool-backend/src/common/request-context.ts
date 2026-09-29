import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request context, available to any code path (logs, services) without threading it through arguments. */
export interface RequestContext {
  requestId: string;
  userId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const currentRequestId = (): string | undefined => requestContext.getStore()?.requestId;
