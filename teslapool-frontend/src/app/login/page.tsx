import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Log in' };

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back to" highlight="TeslaPool" subtitle="Pick up where you left off: your rides, your wallet and, if you drive, your live pool.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
