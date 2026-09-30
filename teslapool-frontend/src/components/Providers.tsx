'use client';

import { mutate, SWRConfig } from 'swr';
import { api, ApiError } from '@/lib/api';
import { SessionGate } from './app/SessionGate';
import { ToastProvider } from './ui/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (path: string) => api.get(path),
        revalidateOnFocus: true,
        // Client errors (401, 403, 404…) will not fix themselves by retrying.
        shouldRetryOnError: (err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500),
        errorRetryCount: 3,
        onError: (err, key) => {
          if (err instanceof ApiError && err.status === 401 && key !== '/auth/me') void mutate('/auth/me', null, { revalidate: false });
        },
      }}
    >
      <ToastProvider>
        <SessionGate>{children}</SessionGate>
      </ToastProvider>
    </SWRConfig>
  );
}
