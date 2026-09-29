'use client';

import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import useSWR from 'swr';
import { ErrorState } from '@/components/ui/States';
import { percent, titleCase } from '@/lib/format';
import type { ImpactStats, Meta } from '@/lib/types';

/** Matching rules, the ride state machine and the zone distance matrix, all read from `/meta`. */
export function EngineRules({ meta }: { meta: Meta }) {
  const r = meta.rules;
  const rules = [
    ['Seats per pool', `${r.poolMaxCapacity}`],
    ['Pickup reach', `${r.pickupMaxHops} zone hop${r.pickupMaxHops === 1 ? '' : 's'}`],
    ['Destination reach', `${r.destinationMaxHops} zone hop${r.destinationMaxHops === 1 ? '' : 's'}`],
    ['Max detour', `${r.maxDetourKm} km / ${Math.round(r.maxDetourRatio * 100)}%`],
    ['Max stops', `${r.maxStops}`],
    ['Late join', r.allowLateJoin ? 'allowed' : 'not allowed'],
    ['Max pool discount', `${meta.fare.maxPoolDiscountPercent}%`],
    ['ML fare band', `±${meta.fare.mlMaxDeviationPercent}%`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {rules.map(([k, v]) => (
        <div key={k} className="rounded-2xl border-subtle bg-white p-4">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">{k}</dt>
          <dd className="mt-1 text-lg font-black">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StateMachine({ meta }: { meta: Meta }) {
  const entries = Object.entries(meta.rideTransitions);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {entries.map(([from, tos]) => (
        <li key={from} className="flex flex-wrap items-center gap-2 rounded-2xl border-subtle bg-white p-3 text-xs">
          <span className={clsx('rounded-full px-2.5 py-1 font-bold', tos.length === 0 ? 'bg-dark text-brand' : 'bg-brand')}>{titleCase(from)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          {tos.length === 0 ? (
            <span className="text-muted">terminal</span>
          ) : (
            tos.map((t) => (
              <span key={t} className="rounded-full bg-chip px-2.5 py-1 font-bold">
                {titleCase(t)}
              </span>
            ))
          )}
        </li>
      ))}
    </ul>
  );
}

/** Zone-to-zone graph distances, shaded by length. */
export function DistanceMatrix({ meta }: { meta: Meta }) {
  const zones = meta.zones;
  const all = zones.flatMap((a) => zones.map((b) => meta.distanceKm[a.code]?.[b.code] ?? meta.distanceKm[b.code]?.[a.code] ?? 0));
  const max = Math.max(...all, 1);
  const short = (name: string) => name.replace('Bashundhara R/A', 'Bashundhara').split(' ')[0];
  return (
    <div className="overflow-x-auto rounded-2xl border-subtle bg-white p-3">
      <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-center text-[11px]">
        <caption className="sr-only">Distance in km between service zones</caption>
        <thead>
          <tr>
            <th className="p-1" />
            {zones.map((z) => (
              <th key={z.code} scope="col" className="p-1 font-bold text-muted">
                {short(z.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zones.map((a) => (
            <tr key={a.code}>
              <th scope="row" className="whitespace-nowrap p-1 text-left font-bold">
                {short(a.name)}
              </th>
              {zones.map((b) => {
                const d = a.code === b.code ? null : meta.distanceKm[a.code]?.[b.code] ?? meta.distanceKm[b.code]?.[a.code];
                const t = d == null ? 0 : d / max;
                return (
                  <td
                    key={b.code}
                    className="rounded-md p-1.5 tabular-nums"
                    style={{ backgroundColor: d == null ? '#FFFEE9' : `rgba(193, 241, 29, ${0.15 + t * 0.85})` }}
                    title={d == null ? a.name : `${a.name} → ${b.name}: ${d} km`}
                  >
                    {d == null ? '·' : d}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 px-1 text-[11px] text-muted">Source: {titleCase(meta.distanceSource).toLowerCase()}. Pricing and matching both use these distances.</p>
    </div>
  );
}

/** Model usage and guardrail outcomes, live from `/stats/impact`. */
export function ModelStats({ initial }: { initial: ImpactStats | null }) {
  const { data, error, mutate } = useSWR<ImpactStats>('/stats/impact', { fallbackData: initial ?? undefined, refreshInterval: 15_000 });
  if (error && !data) return <ErrorState error={error} compact onRetry={() => mutate()} />;
  const ml = data?.ml;
  const op = data?.operational as { matching?: { p50Ms: number | null; p95Ms: number | null; attempts: number; succeeded: number; rejected: number }; concurrency?: { lostRaces: number; capacityGuardHits: number } } | undefined;
  const tiles = [
    ['Fare predictions', ml ? String(ml.farePredictions) : '—', ml ? `${percent(ml.fareAcceptanceRate)} inside the guardrail` : ''],
    ['ETA predictions', ml ? String(ml.etaPredictions) : '—', ml ? `${ml.etaAccepted} accepted` : ''],
    ['Match attempts', op?.matching ? String(op.matching.attempts) : '—', op?.matching ? `${op.matching.succeeded} matched · ${op.matching.rejected} rejected` : ''],
    ['Matching p95', op?.matching?.p95Ms != null ? `${op.matching.p95Ms} ms` : '—', op?.matching?.p50Ms != null ? `p50 ${op.matching.p50Ms} ms` : 'this API instance'],
    ['Seat races lost', op?.concurrency ? String(op.concurrency.lostRaces) : '—', 'handled safely, never overbooked'],
    ['Capacity guard hits', op?.concurrency ? String(op.concurrency.capacityGuardHits) : '—', 'database last line of defence'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map(([k, v, hint]) => (
        <div key={k} className="card p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{k}</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{v}</p>
          {hint && <p className="text-[11px] text-muted">{hint}</p>}
        </div>
      ))}
    </div>
  );
}
