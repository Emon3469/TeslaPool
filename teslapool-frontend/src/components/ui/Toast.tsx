'use client';

import clsx from 'clsx';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

const ToastContext = createContext<((t: Omit<Toast, 'id'>) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((all) => [...all.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-4 z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-2xl border p-4 shadow-card-hover',
              t.tone === 'error' ? 'border-red-200 bg-white' : 'border-dark/10 bg-white',
            )}
          >
            {t.tone === 'success' && <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-lime-600" aria-hidden="true" />}
            {t.tone === 'error' && <XCircle className="h-5 w-5 flex-shrink-0 text-red-600" aria-hidden="true" />}
            {t.tone === 'info' && <Info className="h-5 w-5 flex-shrink-0 text-dark" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-dark">{t.title}</p>
              {t.body && <p className="mt-0.5 break-words text-xs text-muted">{t.body}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="rounded-md p-0.5 text-muted hover:text-dark" aria-label="Dismiss notification">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return useMemo(
    () => ({
      success: (title: string, body?: string) => push({ tone: 'success', title, body }),
      error: (title: string, body?: string) => push({ tone: 'error', title, body }),
      info: (title: string, body?: string) => push({ tone: 'info', title, body }),
    }),
    [push],
  );
}
