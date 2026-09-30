'use client';

import { ShieldAlert } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { homeFor, useSessionChange } from '@/lib/hooks';
import { listenForOtherTabs, observeSessionUser } from '@/lib/session-guard';
import type { User } from '@/lib/types';

const ROLE_LABEL: Record<User['role'], string> = { PASSENGER: 'passenger', DRIVER: 'driver', ADMIN: 'admin' };
const first = (name: string) => name.split(' ')[0];

/**
 * Pauses the tab when the browser's session now belongs to another account (someone signed in or out
 * in a different tab). The page underneath is made inert, nothing is redirected, and the person
 * chooses: sign back in as the tab's account, or knowingly continue as the account that is signed in.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const change = useSessionChange();
  const pathname = usePathname();
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => listenForOtherTabs(), []);

  // A refused API call doesn't say who is signed in now; ask (auth routes always answer for the cookie).
  useEffect(() => {
    if (!change || change.current !== undefined) return;
    api
      .get<User>('/auth/me')
      .then((u) => observeSessionUser(u))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) observeSessionUser(null);
      });
  }, [change]);

  useEffect(() => {
    if (change) primary.current?.focus();
  }, [change]);

  return (
    <>
      <div className="contents" inert={change ? true : undefined} aria-hidden={change ? true : undefined}>
        {children}
      </div>
      {change && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-dark/70 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true" aria-labelledby="session-gate-h" aria-describedby="session-gate-d" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
              <ShieldAlert className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 id="session-gate-h" className="mt-4 text-2xl font-black tracking-tight">
              This tab is paused
            </h2>
            <div id="session-gate-d" className="mt-2 space-y-2 text-sm text-dark/80">
              <p>
                This tab was signed in as <span className="font-bold">{change.tab.name}</span> ({ROLE_LABEL[change.tab.role]}).{' '}
                {change.current === undefined
                  ? 'Another tab changed who is signed in.'
                  : change.current === null
                    ? 'You logged out in another tab.'
                    : (
                      <>
                        Another tab signed in as <span className="font-bold">{change.current.name}</span> ({ROLE_LABEL[change.current.role]}).
                      </>
                    )}
              </p>
              <p>
                All tabs in one browser share a single sign-in, so this tab stopped instead of acting as someone else.{' '}
                <span className="font-bold">Nothing was booked or changed.</span>
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button ref={primary} variant="dark" onClick={() => window.location.assign(`/login?next=${encodeURIComponent(pathname)}`)}>
                Sign in as {first(change.tab.name)} again
              </Button>
              {change.current && (
                <Button variant="outline" onClick={() => window.location.assign(homeFor(change.current ?? null))}>
                  Continue as {first(change.current.name)}
                </Button>
              )}
            </div>
            <p className="mt-5 rounded-2xl bg-cream p-3 text-xs text-dark/70">
              Testing several accounts at once? Open each one in its own Incognito window or browser profile. Each keeps a separate sign-in.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
