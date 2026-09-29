import { getSessionUser } from '@/lib/server-session';
import { SessionFallback } from './SessionFallback';

/**
 * Wraps signed-in routes: the user is fetched on the server and handed to SWR as the initial
 * `/auth/me` value, so pages render with the account immediately instead of waiting for a
 * client round-trip before they can start loading their own data.
 */
export async function SessionBoundary({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return <SessionFallback user={user}>{children}</SessionFallback>;
}
