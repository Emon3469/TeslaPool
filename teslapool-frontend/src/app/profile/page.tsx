'use client';

import { useState } from 'react';
import { AppPage } from '@/components/app/AppPage';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { formatDateTime, initials } from '@/lib/format';
import { useLogout, useMe } from '@/lib/hooks';
import type { User } from '@/lib/types';

const PHONE = /^\+?[0-9]{7,15}$/;

export default function ProfilePage() {
  return <AppPage title="Profile">{(user) => <ProfileLoader sessionUser={user} />}</AppPage>;
}

/** The session user (GET /auth/me) is the profile; re-key the form when it changes. */
function ProfileLoader({ sessionUser }: { sessionUser: User }) {
  return <ProfileInner key={sessionUser.id} user={sessionUser} />;
}

function ProfileInner({ user }: { user: User }) {
  const toast = useToast();
  const { mutate } = useMe();
  const logout = useLogout();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const cleanPhone = phone.replace(/[\s-]/g, '');
  const phoneError = cleanPhone && !PHONE.test(cleanPhone) ? 'Use digits only, e.g. +8801712345678.' : undefined;
  const nameError = name.trim() ? undefined : 'Name can’t be empty.';
  const dirty = name.trim() !== user.name || (cleanPhone || null) !== (user.phone ?? null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (phoneError || nameError) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<User>('/users/me', { name: name.trim(), phone: cleanPhone || null });
      await mutate(updated, { revalidate: false });
      toast.success('Profile saved');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="card flex flex-col items-center p-8 text-center lg:col-span-4">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand text-2xl font-black">{initials(user.name)}</span>
        <p className="mt-4 text-lg font-black">{user.name}</p>
        <p className="text-sm text-muted">{user.email}</p>
        <span className="badge-tag mt-3 bg-mint text-[10px] font-bold uppercase tracking-wider">{user.role.toLowerCase()}</span>
        {user.emailVerified ? (
          <span className="mt-2 text-xs font-bold text-lime-700">✓ Email verified</span>
        ) : (
          <a href="/verify-email?next=/profile" className="mt-2 text-xs font-bold text-red-700 underline-offset-2 hover:underline">
            Email not verified. Enter code
          </a>
        )}
        <p className="mt-4 text-xs text-muted">Member since {formatDateTime(user.createdAt)}</p>
        <Button variant="ghost" className="mt-6 text-red-700" onClick={logout}>
          Log out
        </Button>
      </div>
      <form onSubmit={save} className="card space-y-4 p-6 lg:col-span-8" noValidate>
        <h2 className="font-black">Your details</h2>
        <Field label="Full name" error={nameError}>
          {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" />}
        </Field>
        <Field label="Email" hint="Email can’t be changed.">
          {(p) => <input {...p} className="input" value={user.email} disabled readOnly />}
        </Field>
        <Field label="Phone" hint="Optional. Never shown to co-riders." error={phoneError}>
          {(p) => <input {...p} type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8801712345678" autoComplete="tel" />}
        </Field>
        {error !== null && <ErrorState error={error} compact />}
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!dirty || Boolean(phoneError || nameError)}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
