'use client';

import clsx from 'clsx';
import { CheckCircle2, XCircle } from 'lucide-react';
import useSWR from 'swr';
import { ErrorState } from '@/components/ui/States';
import { formatBdt, formatTime, percent } from '@/lib/format';
import type { ImpactStats } from '@/lib/types';

type MoneyLike = { amountPoysha?: number } | null | undefined;
const bdt = (m: MoneyLike) => (m && typeof m.amountPoysha === 'number' ? formatBdt(m.amountPoysha) : '—');
const num = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : n.toFixed(digits));

function Kpi({ label, value, hint, accent = false }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={clsx('rounded-3xl p-6', accent ? 'on-lime bg-brand' : 'card')}>
      <p className={clsx('text-[11px] font-bold uppercase tracking-wider', accent ? 'text-dark/70' : 'text-muted')}>{label}</p>
      <p className="mt-2 text-4xl font-black tabular-nums tracking-tight">{value}</p>
      {hint && <p className={clsx('mt-1 text-xs', accent ? 'text-dark/70' : 'text-muted')}>{hint}</p>}
    </div>
  );
}

function Check({ label, value, okWhenZero = true }: { label: string; value: number; okWhenZero?: boolean }) {
  const ok = okWhenZero ? value === 0 : value > 0;
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="flex items-center gap-2.5">
        {ok ? <CheckCircle2 className="h-4 w-4 text-lime-600" aria-hidden="true" /> : <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />}
        {label}
      </span>
      <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums', ok ? 'bg-mint' : 'bg-red-50 text-red-700')}>{value}</span>
    </li>
  );
}

/** Every figure is read from `GET /stats/impact`, which computes it from the database on each request. */
export function ImpactDashboard({ initial }: { initial: ImpactStats | null }) {
  const { data, error, mutate, isValidating } = useSWR<ImpactStats>('/stats/impact', { fallbackData: initial ?? undefined, refreshInterval: 15_000 });

  if (!data) return error ? <ErrorState error={error} onRetry={() => mutate()} title="Live impact is unavailable" /> : <div className="skeleton h-96" />;

  const op = data.operational as {
    http?: { p50Ms: number | null; p95Ms: number | null; samples: number };
    matching?: { p50Ms: number | null; p95Ms: number | null; samples: number };
    concurrency?: { lostRaces: number; capacityGuardHits: number };
    invalidTransitionsRejected?: number;
  };
  const i = data.integrity;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-500 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime-600" />
          </span>
          Live · updated {formatTime(data.generatedAt)} {isValidating && '· refreshing…'}
        </span>
        <span>Auto-refreshes every 15 seconds</span>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi accent label="Passenger savings" value={bdt(data.pooling.totalPassengerSavings as MoneyLike)} hint={`${bdt(data.pooling.averageSavingPerPooledPassenger as MoneyLike)} per pooled rider`} />
        <Kpi label="Match success" value={percent(data.matching.matchSuccessRate)} hint={`${data.matching.ridesMatched} of ${data.matching.ridesAttempted} rides matched`} />
        <Kpi label="Seat utilisation" value={percent(data.occupancy.seatUtilization)} hint={`${num(data.occupancy.averagePassengersPerPool, 1)} riders per completed pool`} />
        <Kpi label="Avg. pool discount" value={data.pooling.averageDiscountPercent === null ? '—' : `${num(data.pooling.averageDiscountPercent, 1)}%`} hint={`${num(data.pooling.averageDetourKm, 2)} km average detour`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card p-6" aria-labelledby="rides-h">
          <h3 id="rides-h" className="text-sm font-bold">
            Rides
          </h3>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            {[
              ['Total', data.rides.total],
              ['Active now', data.rides.active],
              ['Completed', data.rides.completed],
              ['Cancelled', data.rides.cancelled],
              ['Pooled riders', data.pooling.pooledPassengers],
              ['Completed pools', data.occupancy.completedPools],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-2xl font-black tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card p-6" aria-labelledby="integrity-h">
          <h3 id="integrity-h" className="text-sm font-bold">
            Integrity checks
          </h3>
          <p className="mt-1 text-xs text-muted">Recounted from raw records across {i.checkedPools} pools.</p>
          <ul className="mt-2 divide-y divide-dark/5">
            <Check label="Capacity violations" value={i.capacityViolations} />
            <Check label="Seat counter drift" value={i.occupancyCounterDrift} />
            <Check label="Wallet balance drift" value={i.walletBalanceDrift} />
            <Check label="Payment amount mismatches" value={i.paymentAmountMismatches} />
            <Check label="Completed rides without payment" value={i.completedRidesWithoutPayment} />
          </ul>
        </section>

        <section className="card p-6" aria-labelledby="ops-h">
          <h3 id="ops-h" className="text-sm font-bold">
            Payments & operations
          </h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Settled payments</dt>
              <dd className="font-bold tabular-nums">{data.payments.settled}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Paid in cash</dt>
              <dd className="font-bold tabular-nums">{bdt(data.payments.cash as MoneyLike)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Paid with TeslaPay</dt>
              <dd className="font-bold tabular-nums">{bdt(data.payments.teslaPay as MoneyLike)}</dd>
            </div>
            <div className="flex justify-between border-t border-dark/5 pt-3">
              <dt className="text-muted">API p95 latency</dt>
              <dd className="font-bold tabular-nums">{op.http?.p95Ms == null ? '—' : `${op.http.p95Ms} ms`}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Matching p95</dt>
              <dd className="font-bold tabular-nums">{op.matching?.p95Ms == null ? '—' : `${op.matching.p95Ms} ms`}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Lost seat races (handled)</dt>
              <dd className="font-bold tabular-nums">{op.concurrency?.lostRaces ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Invalid transitions refused</dt>
              <dd className="font-bold tabular-nums">{op.invalidTransitionsRejected ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[11px] text-muted">Latency figures cover this API instance since it started.</p>
        </section>
      </div>
    </div>
  );
}
