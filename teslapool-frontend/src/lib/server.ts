import 'server-only';
import { connection } from 'next/server';
import type { ImpactStats, Meta } from './types';

const BACKEND = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/**
 * Server-side read of a public endpoint. Marketing pages must render even when the API is down,
 * so failures return null and the page shows a graceful placeholder instead of an error.
 */
async function publicGet<T>(path: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND}/api/v1${path}`, {
      next: { revalidate },
      signal: AbortSignal.timeout(2500),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: T };
    return json.success ? (json.data ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * If the API cannot be reached while a page is pre-rendered (a build while Render is asleep), opt that
 * render out of static caching instead of freezing "unavailable" into the page: `connection()` makes
 * the route render per request, so the next visitor gets live data. At request time it is a no-op,
 * and a failed background revalidation simply keeps the last good page.
 */
async function orLive<T>(value: T | null): Promise<T | null> {
  if (value === null) await connection();
  return value;
}

export const getMeta = async () => orLive(await publicGet<Meta>('/meta', 300));
export const getImpact = async () => orLive(await publicGet<ImpactStats>('/stats/impact', 30));
