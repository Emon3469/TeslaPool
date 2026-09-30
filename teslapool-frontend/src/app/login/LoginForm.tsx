'use client';

import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { homeFor, useLogout, useMe } from '@/lib/hooks';
import { goAfterAuth, safeNext } from '@/lib/navigation';
import { adoptSessionAccount } from '@/lib/session-guard';
import type { User } from '@/lib/types';

import { DEMO_ACCOUNTS } from '@/content/demo';

export function LoginForm() {
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const expired = params.get('reason') === 'expired';
  const { user: current } = useMe();
  const logout = useLogout();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ user: User }>('/auth/login', { email: email.trim(), password });
      // Claim this tab for the new account and tell the other tabs (they pause instead of silently switching).
      adoptSessionAccount(res.user);
      // Clear anything cached for a previous user, then seed the session.
      await mutate(() => true, undefined, { revalidate: false });
      await mutate('/auth/me', res.user, { revalidate: false });
      goAfterAuth(safeNext(params.get('next')) ?? homeFor(res.user));
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const invalid = error instanceof ApiError && error.code === 'INVALID_CREDENTIALS';

  return (
    <div>
      <h2 className="text-2xl font-black tracking-tight">Log in</h2>
      <p className="mt-1 text-sm text-muted">
        New here?{' '}
        <Link href={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-bold text-dark underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>

      {current && !expired && (
        <div role="status" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-mint px-4 py-3 text-sm">
          <span>
            You’re signed in as <span className="font-bold">{current.name}</span>. Logging in as someone else signs {current.name.split(' ')[0]} out of every tab in this
            browser. To use two accounts side by side, open one in an Incognito window or another browser profile.
          </span>
          <span className="flex gap-2">
            <Link href={homeFor(current)} className="font-bold underline-offset-2 hover:underline">
              Continue
            </Link>
            <button type="button" onClick={logout} className="font-bold text-red-700 underline-offset-2 hover:underline">
              Log out
            </button>
          </span>
        </div>
      )}
      {params.get('loggedOut') === '1' && !error && (
        <p role="status" className="mt-5 rounded-2xl bg-mint px-4 py-3 text-sm">
          You’ve been logged out. See you on the next ride.
        </p>
      )}
      {expired && !error && (
        <p role="status" className="mt-5 rounded-2xl bg-mint px-4 py-3 text-sm">
          Your session ended. Please log in again.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="Email">
          {(p) => <input {...p} type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}
        </Field>
        <div className="-mb-2 flex justify-end">
          <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-xs font-bold text-dark/70 underline-offset-2 hover:text-dark hover:underline">
            Forgot password?
          </Link>
        </div>
        <Field label="Password" error={invalid ? 'Email or password is incorrect.' : undefined}>
          {(p) => (
            <div className="relative">
              <input
                {...p}
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                className="input pr-12"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-dark"
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          )}
        </Field>
        {error !== null && !invalid && <ErrorState error={error} compact />}
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!email || !password}>
          Log in
        </Button>
      </form>

      {DEMO_ACCOUNTS.length > 0 && (
        <div className="mt-8 rounded-2xl bg-cream p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Try the demo</p>
          <p className="mt-1 text-xs text-muted">Seeded story cast, already verified. Tap one to fill both fields, then log in.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((d) => (
              <button
                key={d.email}
                type="button"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                  setError(null);
                }}
                className="rounded-xl border border-dark/10 bg-white px-3 py-2 text-left transition hover:border-dark hover:bg-brand"
              >
                <span className="block text-sm font-bold">
                  {d.name} <span className="font-normal text-muted">· {d.role}</span>
                </span>
                <span className="block truncate font-mono text-[11px] text-muted">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
