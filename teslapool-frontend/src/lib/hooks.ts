'use client';

import { useCallback, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import { api, ApiError } from './api';
import { announceSignOut, getSessionChange, observeSessionUser, subscribeSessionChange, type SessionChange } from './session-guard';
import type { Meta, User } from './types';

/**
 * The signed-in user, or null when there is no valid session (401 is not an error here).
 * `sessionChanged` is true when the browser is now signed in as a different account than the one
 * this tab loaded with (another tab signed in); pages must not render that account's data.
 */
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
  const sessionChanged = !observeSessionUser(data);
  return { user: data ?? null, isLoading, error, mutate, sessionChanged };
}

/** Non-null once this tab's account was replaced by a sign-in or sign-out in another tab. */
export function useSessionChange(): SessionChange | null {
  return useSyncExternalStore(subscribeSessionChange, getSessionChange, () => null);
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
      announceSignOut();
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
