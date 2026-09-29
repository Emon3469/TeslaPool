'use client';

import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { CodeInput } from '@/components/ui/CodeInput';
import { Field } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';

export function ResetPassword() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const problems = {
    email: /^\S+@\S+\.\S+$/.test(email.trim()) ? undefined : 'Enter the email you signed up with.',
    password: password.length >= 8 ? undefined : 'At least 8 characters.',
    confirm: confirm === password ? undefined : 'The passwords don’t match.',
  };
  const valid = code.length === 6 && !Object.values(problems).some(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { email: email.trim(), code, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-lime-600" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-black">Password changed</h2>
        <p className="mt-1 text-sm text-muted">Log in with your new password.</p>
        <ButtonLink href={`/login?email=${encodeURIComponent(email.trim())}`} size="lg" className="mt-6">
          Log in
        </ButtonLink>
      </div>
    );
  }

  const codeErr = error instanceof ApiError && ['INVALID_CODE', 'CODE_EXPIRED', 'TOO_MANY_ATTEMPTS'].includes(error.code) ? error.message : null;

  return (
    <div>
      <h2 className="text-2xl font-black tracking-tight">Choose a new password</h2>
      {params.get('sent') === '1' && (
        <p role="status" className="mt-3 rounded-2xl bg-mint px-4 py-3 text-sm">
          If an account exists for that email, a code is on its way. Check spam if it doesn’t arrive within a minute.
        </p>
      )}
      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <Field label="Email" error={touched ? problems.email : undefined}>
          {(p) => <input {...p} type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <div>
          <p className="label">Code from the email</p>
          <CodeInput value={code} onChange={setCode} invalid={Boolean(codeErr)} label="Reset code" />
          {codeErr && <p className="mt-2 text-center text-sm font-medium text-red-700">{codeErr}</p>}
        </div>
        <Field label="New password" hint="At least 8 characters." error={touched ? problems.password : undefined}>
          {(p) => (
            <div className="relative">
              <input {...p} type={show ? 'text' : 'password'} autoComplete="new-password" className="input pr-12" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-dark" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          )}
        </Field>
        <Field label="Confirm new password" error={touched ? problems.confirm : undefined}>
          {(p) => <input {...p} type={show ? 'text' : 'password'} autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} />}
        </Field>
        {error !== null && !codeErr && <ErrorState error={error} compact />}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Change password
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        No code?{' '}
        <Link href="/forgot-password" className="font-bold text-dark underline-offset-2 hover:underline">
          Send another
        </Link>
      </p>
    </div>
  );
}
