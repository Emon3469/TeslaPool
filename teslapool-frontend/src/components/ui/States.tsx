'use client';

import clsx from 'clsx';
import { AlertTriangle, Inbox, MailCheck, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={clsx('h-16', i === 0 && 'h-24')} />
      ))}
    </div>
  );
}

/** Shows the API's code and request id, so a user can quote them and ops can find the log line. */
export function ErrorState({ error, onRetry, title = 'Something went wrong', compact = false }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  const apiErr = error instanceof ApiError ? error : null;
  const message = apiErr?.message ?? (error instanceof Error ? error.message : 'Unexpected error.');
  return (
    <div role="alert" className={clsx('rounded-2xl border border-red-200 bg-red-50/70 text-left', compact ? 'p-3' : 'p-5')}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {!compact && <p className="text-sm font-bold text-dark">{title}</p>}
          <p className="text-sm text-dark/80">{message}</p>
          {apiErr && (
            <p className="mt-1 break-all font-mono text-[11px] text-muted">
              {apiErr.code}
              {apiErr.requestId ? ` · request ${apiErr.requestId}` : ''}
            </p>
          )}
          {apiErr?.code === 'EMAIL_NOT_VERIFIED' && (
            <Link href="/verify-email" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-dark px-3 py-1.5 text-xs font-bold text-brand hover:bg-black">
              <MailCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verify my email
            </Link>
          )}
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-dark underline-offset-2 hover:underline">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-dark/15 bg-white/60 px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint text-dark">{icon ?? <Inbox className="h-6 w-6" aria-hidden="true" />}</div>
      <h3 className="text-base font-bold text-dark">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
