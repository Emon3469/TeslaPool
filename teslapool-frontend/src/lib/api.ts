/**
 * Thin client for the TeslaPool API.
 *
 * Every call goes to `/api/v1/*` on this origin; Next.js proxies it to the API (see next.config.ts), so the
 * HttpOnly `tp_session` cookie is first-party and the browser sends an allow-listed Origin on writes (CSRF).
 * Responses use the `{ success, data, meta }` envelope; failures become an `ApiError` carrying the API's code
 * and request id, which the UI shows so any error can be traced in the server logs.
 */

export const API_PREFIX = '/api/v1';

export interface ResponseMeta {
  requestId?: string;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Makes a write safe to retry: the API replays the first response for the same key. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

type Envelope<T> = {
  success?: boolean;
  data?: T;
  meta?: ResponseMeta;
  error?: { code: string; message: string; requestId?: string; details?: Record<string, unknown> };
};

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; meta: ResponseMeta }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(API_PREFIX + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach TeslaPool. Check your connection and try again.');
  }

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    // A non-JSON body only comes from the proxy when the API itself is down.
  }

  if (!res.ok || !envelope || envelope.success !== true) {
    const err = envelope?.error;
    if (err) throw new ApiError(res.status, err.code, err.message, err.requestId, err.details);
    throw new ApiError(
      res.status,
      res.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNEXPECTED_RESPONSE',
      'The TeslaPool service is not responding right now. Please try again shortly.',
    );
  }
  return { data: envelope.data as T, meta: envelope.meta ?? {} };
}

export const api = {
  get: async <T>(path: string, signal?: AbortSignal) => (await apiRequest<T>(path, { signal })).data,
  post: async <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    (await apiRequest<T>(path, { ...opts, method: 'POST', body })).data,
  patch: async <T>(path: string, body: unknown) => (await apiRequest<T>(path, { method: 'PATCH', body })).data,
};

/** A fresh Idempotency-Key (fits the API's `[A-Za-z0-9._:-]{1,128}` rule). */
export function newIdempotencyKey(prefix = 'web'): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

/** Human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
