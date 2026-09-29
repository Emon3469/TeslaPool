'use client';

import { CheckCircle2, MailCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { CodeInput } from '@/components/ui/CodeInput';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api';
import { homeFor, useMe } from '@/lib/hooks';
import { goAfterAuth, safeNext } from '@/lib/navigation';
import type { User } from '@/lib/types';

const RESEND_SECONDS = 60;

function useCountdown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export function VerifyEmail() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { user, isLoading, mutate } = useMe();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const [error, setError] = useState<unknown>(null);
  // A code was just sent on sign-up (?sent=1), so the first resend waits out the cooldown.
  const [cooldown, setCooldown] = useCountdown(params.get('sent') === '1' ? RESEND_SECONDS : 0);
  const next = safeNext(params.get('next'));

  useEffect(() => {
    if (!isLoading && !user) router.replace(`/login?next=${encodeURIComponent('/verify-email')}`);
  }, [isLoading, user, router]);

  if (isLoading || !user) return <LoadingBlock rows={2} label="Loading your account" />;

  if (user.emailVerified) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-lime-600" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-black">Your email is verified</h2>
        <p className="mt-1 text-sm text-muted">{user.email}</p>
        <ButtonLink href={next ?? homeFor(user)} size="lg" className="mt-6">
          Continue
        </ButtonLink>
      </div>
    );
  }

  async function verify(value = code) {
    if (value.length !== 6) return;
    setBusy('verify');
    setError(null);
    try {
      const updated = await api.post<User>('/auth/email/verify', { code: value });
      await mutate(updated, { revalidate: false });
      toast.success('Email verified', 'You can now book rides, drive and use TeslaPay.');
      goAfterAuth(next ?? homeFor(updated));
    } catch (e) {
      setError(e);
      setCode('');
      if (e instanceof ApiError && e.code === 'EMAIL_ALREADY_VERIFIED') await mutate();
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    setBusy('resend');
    setError(null);
    try {
      const r = await api.post<{ sent: true; retryAfterSeconds: number }>('/auth/email/resend');
      setCooldown(r.retryAfterSeconds);
      setCode('');
      toast.info('New code sent', `Check ${user!.email}. The previous code no longer works.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RESEND_TOO_SOON') setCooldown(Number(e.details?.retryAfterSeconds) || RESEND_SECONDS);
      else setError(e);
    } finally {
      setBusy(null);
    }
  }

  const code_ = error instanceof ApiError ? error.code : null;
  const hint =
    code_ === 'INVALID_CODE'
      ? error instanceof ApiError && error.message
      : code_ === 'CODE_EXPIRED'
        ? 'That code has expired. Send a new one below.'
        : code_ === 'TOO_MANY_ATTEMPTS'
          ? 'Too many wrong tries. Send a new code below.'
          : null;

  return (
    <div>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
        <MailCheck className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-2xl font-black tracking-tight">Check your inbox</h2>
      <p className="mt-1 text-sm text-muted">
        Enter the 6-digit code we sent to <span className="font-bold text-dark">{user.email}</span>. It expires in 10 minutes.
      </p>

      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy === 'verify'} invalid={Boolean(hint)} />
        <div aria-live="polite" className="min-h-[1.25rem] text-center text-sm">
          {hint && <p className="font-medium text-red-700">{hint}</p>}
        </div>
        {error !== null && !hint && <ErrorState error={error} compact />}
        <Button type="submit" size="lg" className="w-full" loading={busy === 'verify'} disabled={code.length !== 6}>
          Verify email
        </Button>
      </form>

      <div className="mt-6 rounded-2xl bg-cream p-4 text-sm">
        <p className="font-bold">Didn’t get it?</p>
        <p className="mt-1 text-muted">It can take a minute. Check your spam or promotions folder for an email from TeslaPool.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={resend} loading={busy === 'resend'} disabled={busy !== null || cooldown > 0}>
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        </Button>
      </div>
    </div>
  );
}
