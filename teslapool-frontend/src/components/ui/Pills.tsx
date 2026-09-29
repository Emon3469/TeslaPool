import clsx from 'clsx';
import { PHASE_LABEL, RIDE_STATUS_LABEL } from '@/lib/format';
import type { RidePhase, RideStatus } from '@/lib/types';

const phaseTone: Record<RidePhase, string> = {
  WAITING: 'bg-chip text-dark',
  MATCHED: 'bg-brand text-dark',
  IN_PROGRESS: 'bg-dark text-brand',
  COMPLETED: 'bg-mint text-dark',
  CANCELLED: 'bg-red-50 text-red-700',
};

export function PhasePill({ phase, status, className }: { phase: RidePhase; status?: RideStatus; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', phaseTone[phase], className)}>
      {(phase === 'WAITING' || phase === 'IN_PROGRESS') && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {status ? RIDE_STATUS_LABEL[status] : PHASE_LABEL[phase]}
    </span>
  );
}

export function Chip({ children, active = false, className }: { children: React.ReactNode; active?: boolean; className?: string }) {
  return <span className={clsx('badge-tag', active && 'bg-brand', className)}>{children}</span>;
}

export function SectionTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx('badge-tag mb-3', className)}>{children}</span>;
}
