'use client';

import clsx from 'clsx';
import { Check, ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import { formatBdt, routeLabel, titleCase } from '@/lib/format';
import type { MatchDecision, Zone } from '@/lib/types';

/** One pool evaluated against one request: verdict, reasons, route, seats and the passenger's fare. */
export function MatchDecisionCard({
  decision,
  zones,
  title,
  action,
  defaultOpen = false,
}: {
  decision: MatchDecision;
  zones?: Zone[];
  title?: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ok = decision.decision === 'MATCHED';
  const cap = decision.capacity;

  return (
    <article className={clsx('rounded-3xl border-2 bg-white p-5 transition', ok ? 'border-brand shadow-card' : 'border-dark/[0.06]')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{title}</div>}
          <p className={clsx('flex items-center gap-2 font-bold', ok ? 'text-dark' : 'text-dark/70')}>
            <span className={clsx('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full', ok ? 'bg-brand' : 'bg-red-50 text-red-700')}>
              {ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            {decision.headline}
          </p>
          {decision.route && decision.route.length > 0 && <p className="mt-1.5 text-sm text-muted">Route: {routeLabel(decision.route, zones)}</p>}
        </div>
        {ok && decision.fare && (
          <div className="text-right">
            <p className="text-2xl font-black tabular-nums">{formatBdt(decision.fare.farePoysha)}</p>
            {decision.fare.discountBps > 0 && (
              <p className="text-xs text-muted">
                <s>{formatBdt(decision.fare.soloFarePoysha)}</s> · −{decision.fare.discountPercent}%
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="badge-tag">
          Seats {cap.before}/{cap.total} → {ok ? cap.after : cap.before}/{cap.total}
        </span>
        {typeof decision.detourKm === 'number' && <span className="badge-tag">Detour {decision.detourKm} km</span>}
        {typeof decision.totalDistanceKm === 'number' && <span className="badge-tag">{decision.totalDistanceKm} km route</span>}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold text-dark/70 hover:bg-cream hover:text-dark"
        >
          Why? <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="mt-4 animate-fade-up space-y-4 border-t border-dark/5 pt-4">
          <ul className="space-y-2" aria-label="Rule checks">
            {decision.checks.map((c) => (
              <li key={c.rule + c.code} className="flex items-start gap-2.5 text-sm">
                {c.passed ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-lime-600" aria-label="passed" /> : <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-label="failed" />}
                <span className={c.passed ? 'text-dark/80' : 'font-medium text-dark'}>{c.message}</span>
              </li>
            ))}
          </ul>
          {decision.alternatives.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Stop orders considered</p>
              <ul className="space-y-1.5">
                {decision.alternatives.map((a) => (
                  <li key={a.route.join('>')} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={clsx('rounded-full px-2 py-0.5 font-bold', a.feasible ? 'bg-mint' : 'bg-red-50 text-red-700')}>{a.feasible ? 'feasible' : 'rejected'}</span>
                    <span className="text-dark/80">{routeLabel(a.route, zones)}</span>
                    {!a.feasible && a.violations.length > 0 && <span className="text-muted">({a.violations.map(titleCase).join(', ')})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {action && <div className="mt-4">{action}</div>}
    </article>
  );
}
