import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { VerifyEmail } from './VerifyEmail';

export const metadata: Metadata = { title: 'Verify your email' };

export default function VerifyEmailPage() {
  return (
    <AuthShell title="One quick check," highlight="then you ride." subtitle="We emailed you a 6-digit code. It keeps accounts real, so every seat in a pool belongs to a genuine rider.">
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </AuthShell>
  );
}
