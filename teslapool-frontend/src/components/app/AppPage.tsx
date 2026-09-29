'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { MailWarning } from 'lucide-react';
import { homeFor, useMe, useMeta } from '@/lib/hooks';
import type { Role, User } from '@/lib/types';

const TABS: Record<Role, { href: string; label: string }[]> = {
  PASSENGER: [
    { href: '/passenger', label: 'Dashboard' },
    { href: '/ride/new', label: 'Request ride' },
    { href: '/rides', label: 'My rides' },
    { href: '/wallet', label: 'Wallet' },
    { href: '/profile', label: 'Profile' },
  ],
  DRIVER: [
    { href: '/driver', label: 'Dashboard' },
    { href: '/driver/vehicles', label: 'Vehicles' },
    { href: '/driver/history', label: 'History' },
    { href: '/wallet', label: 'Earnings' },
    { href: '/intelligence', label: 'Intelligence' },
    { href: '/profile', label: 'Profile' },
  ],
  ADMIN: [
    { href: '/ops', label: 'Ops console' },
    { href: '/intelligence', label: 'Intelligence' },
    { href: '/rides', label: 'All rides' },
    { href: '/profile', label: 'Profile' },
  ],
};

function tabActive(pathname: string, href: string) {
  if (href === '/driver') return pathname === '/driver';
  if (href === '/rides') return pathname === '/rides' || (pathname.startsWith('/rides/') && pathname !== '/rides/new');
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Shell for signed-in pages: resolves the session, enforces the page's roles, and renders the
 * role's tab bar. `children` receives the user, so pages never render with a missing session.
 */
export function AppPage({
  title,
  subtitle,
  roles,
  actions,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: React.ReactNode;
  roles?: Role[];
  actions?: React.ReactNode;
  wide?: boolean;
  children: (user: User) => React.ReactNode;
}) {
  const { user, isLoading, error, mutate } = useMe();
  const { data: meta } = useMeta();
  const mode = meta?.auth?.emailVerification ?? 'off';
  const router = useRouter();
  const pathname = usePathname();
  const needsVerification = Boolean(user && !user.emailVerified && mode !== 'off' && pathname !== '/verify-email');

  useEffect(() => {
    if (!isLoading && !error && !user) router.replace(`/login?reason=expired&next=${encodeURIComponent(pathname)}`);
  }, [isLoading, error, user, router, pathname]);

  let body: React.ReactNode;
  if (error && !user) body = <ErrorState error={error} onRetry={() => mutate()} title="Could not load your account" />;
  // A server-prefetched user counts as loaded (SWR keeps isLoading true while it refreshes in the background).
  else if (!user) body = <LoadingBlock label="Loading your account" />;
  else if (roles && !roles.includes(user.role))
    body = (
      <div className="card p-8 text-center">
        <h2 className="text-xl font-black">This page is for {roles.map((r) => r.toLowerCase()).join(' or ')} accounts</h2>
        <p className="mt-2 text-sm text-muted">You are signed in as a {user.role.toLowerCase()}.</p>
        <ButtonLink href={homeFor(user)} className="mt-6">
          Go to my dashboard
        </ButtonLink>
      </div>
    );
  else body = children(user);

  const tabs = user ? TABS[user.role] : [];

  return (
    <div className="min-h-[70vh] pb-6">
      {tabs.length > 0 && (
        <div className="border-b border-dark/[0.06] bg-cream print:hidden">
          <nav aria-label="Account" className="container-page no-scrollbar flex gap-1 overflow-x-auto py-2">
            {tabs.map((t) => {
              const active = tabActive(pathname, t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx('whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition', active ? 'bg-dark text-brand' : 'text-dark/70 hover:bg-white hover:text-dark')}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
      <div className={clsx('container-page pt-8', !wide && 'max-w-5xl')}>
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
            {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          </div>
          {actions && user && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {needsVerification && (
          <div role="status" className="on-lime mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl bg-brand p-4 sm:flex-row sm:items-center">
            <p className="flex items-start gap-2.5 text-sm font-medium">
              <MailWarning className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <span>
                <span className="font-bold">Confirm your email.</span>{' '}
                {mode === 'required' ? 'Until then you can look around, but not book rides, drive or top up.' : 'It keeps your account recoverable.'}
              </span>
            </p>
            <ButtonLink href={`/verify-email?next=${encodeURIComponent(pathname)}`} variant="dark" size="sm">
              Enter code
            </ButtonLink>
          </div>
        )}
        {body}
      </div>
    </div>
  );
}
