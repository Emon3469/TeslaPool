import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, apiRequest, newIdempotencyKey } from './api';

function mockFetch(status: number, body: unknown, asJson = true) {
  const fn = vi.fn(async () => new Response(asJson ? JSON.stringify(body) : String(body), { status, headers: { 'content-type': asJson ? 'application/json' : 'text/html' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('unwraps the success envelope and keeps pagination meta', async () => {
    mockFetch(200, { success: true, data: [{ id: 1 }], meta: { requestId: 'r1', page: 2, totalPages: 5 } });
    const res = await apiRequest<{ id: number }[]>('/rides?page=2');
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.meta).toMatchObject({ page: 2, totalPages: 5 });
  });

  it('calls the same-origin proxy with JSON and the idempotency header', async () => {
    const fetchFn = mockFetch(201, { success: true, data: { ok: true }, meta: { requestId: 'r' } });
    await api.post('/wallet/top-up', { amountPoysha: 50000 }, { idempotencyKey: 'topup:1' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/wallet/top-up');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe('{"amountPoysha":50000}');
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe('topup:1');
  });

  it('turns an error envelope into an ApiError with code and request id', async () => {
    mockFetch(409, { success: false, error: { code: 'CAPACITY_EXCEEDED', message: 'Only 1 seat left', requestId: 'req-9' } });
    const err = await api.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'CAPACITY_EXCEEDED', message: 'Only 1 seat left', requestId: 'req-9' });
  });

  it('reports a down API (non-JSON 5xx from the proxy) as SERVICE_UNAVAILABLE', async () => {
    mockFetch(500, '<html>Internal Server Error</html>', false);
    await expect(api.get('/meta')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 500 });
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api.get('/meta')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});

describe('newIdempotencyKey', () => {
  it('is unique and fits the API format', () => {
    const a = newIdempotencyKey('ride');
    const b = newIdempotencyKey('ride');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    expect(a.startsWith('ride:')).toBe(true);
  });
});
