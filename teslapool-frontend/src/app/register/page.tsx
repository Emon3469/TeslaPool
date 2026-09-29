import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <AuthShell title="Join the pool." highlight="Ride together." subtitle="One account to book shared rides, pay with TeslaPay and, if you drive a Tesla, fill every seat.">
      <Suspense>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
