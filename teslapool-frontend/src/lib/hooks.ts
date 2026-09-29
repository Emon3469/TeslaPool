'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { api, ApiError } from './api';
import type { Meta, User } from './types';

/** The signed-in user, or null when there is no valid session (401 is not an error here). */
export function useMe() {
  const { data, error, isLoading, mutate } = useSWR<User | null>(
    '/auth/me',
    async (path: string) => {
      try {
        return await api.get<User>(path);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 30_000 },
  );
  return { user: data ?? null, isLoading, error, mutate };
}

/** Zones, rates, rules and enums. Static per deployment, so cache it for the session. */
export function useMeta() {
  return useSWR<Meta>('/meta', { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 10 * 60_000 });
}

/**
 * Clears the session cookie on the API, then does a full page load of /login. A hard navigation
 * (instead of a client-side route change) drops every cached response and in-memory state at once,
 * so no signed-in page can flash, re-render or redirect elsewhere on the way out.
 */
export function useLogout() {
  return useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      window.location.replace('/login?loggedOut=1');
    }
  }, []);
}

export function homeFor(user: Pick<User, 'role'> | null): string {
  if (!user) return '/login';
  if (user.role === 'DRIVER') return '/driver';
  if (user.role === 'ADMIN') return '/ops';
  return '/passenger';
}
