'use client';

import { useEffect } from 'react';
import { mutate, SWRConfig } from 'swr';
import type { User } from '@/lib/types';

/** Seeds SWR's cache with the server-resolved user (nested SWRConfig merges with the app-wide one). */
export function SessionFallback({ user, children }: { user: User | null; children: React.ReactNode }) {
  // The site header lives outside this subtree; share the user with it without another request.
  useEffect(() => {
    if (user) void mutate('/auth/me', (current: User | null | undefined) => current ?? user, { revalidate: false });
  }, [user]);
  if (!user) return <>{children}</>;
  return <SWRConfig value={{ fallback: { '/auth/me': user } }}>{children}</SWRConfig>;
}
