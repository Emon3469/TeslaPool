import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { ResetPassword } from './ResetPassword';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="New password," highlight="same great rides." subtitle="Enter the code from your email and choose a new password. Codes expire after 10 minutes.">
      <Suspense>
        <ResetPassword />
      </Suspense>
    </AuthShell>
  );
}
