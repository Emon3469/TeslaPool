import { expect, request, type APIRequestContext, type Page } from '@playwright/test';

export const WEB = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** The seeded story cast (README "Demo credentials"). */
export const PASSWORD = { PASSENGER: 'Passenger@2026', DRIVER: 'Driver@2026', ADMIN: 'Admin@2026' } as const;
export const CAST = {
  nusrat: { email: 'nusrat@teslapool.dev', password: PASSWORD.PASSENGER, button: 'Nusrat Jahan' },
  rafiq: { email: 'rafiq@teslapool.dev', password: PASSWORD.PASSENGER, button: 'Rafiq Islam' },
  arif: { email: 'arif@teslapool.dev', password: PASSWORD.PASSENGER, button: 'Arif Hossain' },
  shirin: { email: 'shirin@teslapool.dev', password: PASSWORD.PASSENGER, button: 'Shirin Akter' },
  jashim: { email: 'jashim@teslapool.dev', password: PASSWORD.DRIVER, button: 'Jashim Uddin' },
  ops: { email: 'ops@teslapool.dev', password: PASSWORD.ADMIN, button: 'TeslaPool Ops' },
} as const;
export type Who = keyof typeof CAST;

/** Same formatting as the app (integer poysha → "৳1,234.50"). Independent copy: the test is the oracle. */
export function bdt(poysha: number): string {
  const abs = Math.abs(poysha);
  return `${poysha < 0 ? '-' : ''}৳${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

type Envelope<T> = { success: boolean; data: T; error?: { code: string; message: string } };
let seq = 0;

/** Direct API client (through the web app's /api/v1 proxy) used as the source of truth. */
export class Api {
  private constructor(
    readonly ctx: APIRequestContext,
    readonly who: string,
  ) {}

  static async anonymous(): Promise<Api> {
    return new Api(await request.newContext({ baseURL: WEB }), 'anonymous');
  }

  static async as(who: Who): Promise<Api> {
    const anon = await request.newContext({ baseURL: WEB });
    const res = await anon.post('/api/v1/auth/login', { data: { email: CAST[who].email, password: CAST[who].password } });
    const body = (await res.json()) as Envelope<{ accessToken: string }>;
    expect(res.status(), `login ${who}: ${JSON.stringify(body.error)}`).toBe(200);
    await anon.dispose();
    const ctx = await request.newContext({ baseURL: WEB, extraHTTPHeaders: { authorization: `Bearer ${body.data.accessToken}` } });
    return new Api(ctx, who);
  }

  async raw<T>(method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown): Promise<{ status: number; body: Envelope<T> }> {
    const res = await this.ctx.fetch(`/api/v1${path}`, {
      method,
      data,
      headers: method === 'GET' ? {} : { 'idempotency-key': `e2e:${Date.now()}:${seq++}` },
    });
    return { status: res.status(), body: (await res.json()) as Envelope<T> };
  }

  async get<T>(path: string): Promise<T> {
    const r = await this.raw<T>('GET', path);
    expect(r.status, `${this.who} GET ${path}: ${JSON.stringify(r.body.error)}`).toBe(200);
    return r.body.data;
  }

  async post<T>(path: string, data?: unknown, expected = [200, 201, 202]): Promise<T> {
    const r = await this.raw<T>('POST', path, data);
    expect(expected, `${this.who} POST ${path} → ${r.status} ${JSON.stringify(r.body.error)}`).toContain(r.status);
    return r.body.data;
  }

  async dispose() {
    await this.ctx.dispose();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ride = any;
type Pool = any;

/**
 * Puts the demo into a known state: no active rides anywhere, no other live pools, and Jashim online
 * with an empty Bullet. Only cancels/completes leftover *active* test state; nothing is deleted.
 */
export async function resetDemo(): Promise<{ poolId: string }> {
  const ops = await Api.as('ops');
  const active: Ride[] = await ops.get('/rides?status=ACTIVE&limit=100');
  for (const r of active) {
    if (r.status === 'STARTED') await ops.post(`/rides/${r.rideRequestId}/complete`);
    else await ops.post(`/rides/${r.rideRequestId}/cancel`, { reason: 'E2E reset' });
  }
  const jashim = await Api.as('jashim');
  const me = await jashim.get<{ id: string }>('/auth/me');
  const pools: Pool[] = await ops.get('/pools?status=ACTIVE&limit=100');
  for (const p of pools) if (p.driverId !== me.id && p.occupiedSeats === 0) await ops.post(`/pools/${p.id}/cancel`);

  let status: any = await jashim.get('/driver/status');
  if (!status.online) {
    const bullet = status.vehicles.find((v: any) => v.name === 'Bullet' && v.isActive) ?? status.vehicles.find((v: any) => v.isActive);
    status = await jashim.post('/driver/online', { vehicleId: bullet.id });
  }
  expect(status.pool.availableSeats, 'Bullet should be empty after reset').toBe(status.pool.capacity);
  await Promise.all([ops.dispose(), jashim.dispose()]);
  return { poolId: status.pool.id };
}

/** Requests a ride through the API and joins the given pool; returns the ride id. */
export async function bookAndJoin(who: Who, pickupZone: string, dropoffZone: string, poolId: string, paymentMethod = 'CASH'): Promise<string> {
  const api = await Api.as(who);
  const ride: Ride = await api.post('/rides', { pickupZone, dropoffZone, paymentMethod });
  await api.post(`/pools/${poolId}/join`, { rideRequestId: ride.rideRequestId });
  await api.dispose();
  return ride.rideRequestId;
}

/** Waits until the page's JavaScript has loaded and hydrated, so typed input is not lost. */
export async function ready(page: Page) {
  await page.waitForLoadState('networkidle');
}

/** Logs in through the real login page using the one-click demo button. */
export async function loginUi(page: Page, who: Who) {
  await page.goto('/login');
  await ready(page);
  await page.getByRole('button', { name: new RegExp(CAST[who].button) }).click();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** Fails the test on any uncaught exception in the page. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return () => expect(errors, 'uncaught errors in the page').toEqual([]);
}
