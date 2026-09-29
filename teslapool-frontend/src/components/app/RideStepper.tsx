import clsx from 'clsx';
import { Check } from 'lucide-react';
import { RIDE_STEPS, stepIndex } from '@/lib/ride';
import type { RideStatus } from '@/lib/types';

export function RideStepper({ status }: { status: RideStatus }) {
  if (status === 'CANCELLED') {
    return <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">This ride was cancelled.</p>;
  }
  const current = stepIndex(status);
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Ride progress">
      {RIDE_STEPS.map((s, i) => {
        const done = i < current || status === 'COMPLETED';
        const now = i === current && status !== 'COMPLETED';
        return (
          <li key={s.status} aria-current={now ? 'step' : undefined} className="min-w-0">
            <div className={clsx('h-1.5 rounded-full transition-colors duration-500', done ? 'bg-dark' : now ? 'bg-brand' : 'bg-dark/10')} />
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={clsx(
                  'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-black',
                  done ? 'bg-dark text-brand' : now ? 'bg-brand text-dark ring-4 ring-brand/30' : 'bg-dark/10 text-dark/50',
                )}
              >
                {done ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
              </span>
              <span className={clsx('truncate text-[11px] font-bold sm:text-xs', done || now ? 'text-dark' : 'text-dark/40')}>{s.label}</span>
            </div>
            {now && <p className="mt-1 hidden text-[11px] text-muted sm:block">{s.hint}</p>}
          </li>
        );
      })}
    </ol>
  );
}
