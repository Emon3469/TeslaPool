'use client';

import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPassword />
    </Suspense>
  );
}

function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState(useSearchParams().get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email: email.trim() });
      router.push(`/reset-password?email=${encodeURIComponent(email.trim())}&sent=1`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Locked out?" highlight="Happens to all of us." subtitle="We’ll email you a 6-digit code. Enter it with a new password and you’re back in.">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
        <KeyRound className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-2xl font-black tracking-tight">Reset your password</h2>
      <p className="mt-1 text-sm text-muted">Enter the email you signed up with.</p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="Email">
          {(p) => <input {...p} type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}
        </Field>
        {error !== null && <ErrorState error={error} compact />}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!valid}>
          Email me a code
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-bold text-dark underline-offset-2 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
