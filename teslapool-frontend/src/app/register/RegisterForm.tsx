'use client';

import clsx from 'clsx';
import { Car, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { homeFor } from '@/lib/hooks';
import { adoptSessionAccount } from '@/lib/session-guard';
import { goAfterAuth, safeNext } from '@/lib/navigation';
import type { User } from '@/lib/types';

type Role = 'PASSENGER' | 'DRIVER';
const PHONE = /^\+?[0-9]{7,15}$/;

export function RegisterForm() {
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const [role, setRole] = useState<Role>(params.get('role') === 'DRIVER' ? 'DRIVER' : 'PASSENGER');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const problems = {
    name: form.name.trim() ? undefined : 'Tell us your name.',
    email: /^\S+@\S+\.\S+$/.test(form.email.trim()) ? undefined : 'Enter a valid email address.',
    phone: form.phone && !PHONE.test(form.phone.replace(/[\s-]/g, '')) ? 'Use digits only, e.g. +8801712345678.' : undefined,
    password: form.password.length >= 8 ? undefined : 'At least 8 characters.',
  };
  const valid = !Object.values(problems).some(Boolean);
  const conflict = error instanceof ApiError && error.status === 409;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setError(null);
    setLoading(true);
    try {
      const phone = form.phone.replace(/[\s-]/g, '');
      const res = await api.post<{ user: User; verificationEmailSent?: boolean }>('/auth/register', {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role,
        ...(phone ? { phone } : {}),
      });
      adoptSessionAccount(res.user);
      await mutate(() => true, undefined, { revalidate: false });
      await mutate('/auth/me', res.user, { revalidate: false });
      const next = safeNext(params.get('next'));
      const after = next ?? (res.user.role === 'DRIVER' ? '/driver/vehicles?welcome=1' : homeFor(res.user));
      // Servers with email verification send a code on sign-up; confirm it before going on.
      if (!res.user.emailVerified && res.verificationEmailSent !== undefined) {
        goAfterAuth(`/verify-email?next=${encodeURIComponent(after)}${res.verificationEmailSent ? '&sent=1' : ''}`);
      } else {
        goAfterAuth(after);
      }
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-black tracking-tight">Create your account</h2>
      <p className="mt-1 text-sm text-muted">
        Already have one?{' '}
        <Link href="/login" className="font-bold text-dark underline-offset-2 hover:underline">
          Log in
        </Link>
      </p>

      <fieldset className="mt-6">
        <legend className="label">I want to</legend>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['PASSENGER', 'Ride', 'Book shared seats', UserIcon],
              ['DRIVER', 'Drive', 'Offer my seats', Car],
            ] as const
          ).map(([value, title, sub, Icon]) => (
            <label
              key={value}
              className={clsx(
                'flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3.5 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/60',
                role === value ? 'border-dark bg-brand' : 'border-dark/10 hover:border-dark/30',
              )}
            >
              <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} className="sr-only" />
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>
                <span className="block text-sm font-bold">{title}</span>
                <span className="block text-xs text-dark/60">{sub}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
        <Field label="Full name" error={touched ? problems.name : undefined}>
          {(p) => <input {...p} autoComplete="name" className="input" value={form.name} onChange={set('name')} placeholder="Nusrat Jahan" maxLength={100} />}
        </Field>
        <Field label="Email" error={(touched && problems.email) || (conflict ? 'An account with this email already exists.' : undefined)}>
          {(p) => <input {...p} type="email" autoComplete="email" className="input" value={form.email} onChange={set('email')} placeholder="you@example.com" maxLength={254} />}
        </Field>
        <Field label="Phone (optional)" hint="Shared with nobody. Used only for account recovery." error={touched ? problems.phone : undefined}>
          {(p) => <input {...p} type="tel" autoComplete="tel" className="input" value={form.phone} onChange={set('phone')} placeholder="+8801712345678" />}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={touched ? problems.password : undefined}>
          {(p) => <input {...p} type="password" autoComplete="new-password" className="input" value={form.password} onChange={set('password')} maxLength={128} />}
        </Field>
        {error !== null && !conflict && <ErrorState error={error} compact />}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {role === 'DRIVER' ? 'Create driver account' : 'Create account'}
        </Button>
        <p className="text-center text-[11px] text-muted">
          By continuing you agree to the{' '}
          <Link href="/terms" className="underline">
            terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline">
            privacy notice
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
