import 'server-only';
import { cookies } from 'next/headers';
import type { User } from './types';

const BACKEND = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const COOKIE = process.env.AUTH_COOKIE_NAME ?? 'tp_session';

/**
 * The signed-in user, resolved on the server while the page renders (null when signed out or when
 * the API is slow). The session cookie holds the access token, so it is sent as a Bearer token:
 * a read-only call that needs no Origin/CSRF handling.
 */
export async function getSessionUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${BACKEND}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: User };
    return json.success && json.data ? json.data : null;
  } catch {
    // The client falls back to fetching /auth/me itself.
    return null;
  }
}
