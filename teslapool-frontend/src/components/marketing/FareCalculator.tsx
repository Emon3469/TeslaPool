'use client';

import { ArrowLeftRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { applyDiscountBps, ratesFromMeta, standardFare, zoneDistanceKm } from '@/lib/fare';
import { formatBdt, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';

/**
 * Re-computes the published fare formula in the browser with the live rates from `/meta`.
 * The arithmetic is the API's (integer poysha, half-up), so the result matches a real quote
 * for the same distance and priced duration.
 */
export function FareCalculator() {
  const { data: meta, error, isLoading, mutate } = useMeta();
  const [from, setFrom] = useState('BANANI');
  const [to, setTo] = useState('MOHAKHALI');
  const [minutes, setMinutes] = useState(20);
  const [shared, setShared] = useState(50);

  const result = useMemo(() => {
    if (!meta) return null;
    const km = zoneDistanceKm(meta, from, to);
    if (km === null) return null;
    const solo = standardFare(km, minutes, ratesFromMeta(meta));
    const maxBps = Math.round(meta.fare.maxPoolDiscountPercent * 100);
    // The API scales the discount with the passenger's shared fraction and caps it at the maximum.
    const discountBps = Math.min(maxBps, Math.round((maxBps * shared) / 100));
    return { km, solo, discountBps, pooled: applyDiscountBps(solo.totalPoysha, discountBps) };
  }, [meta, from, to, minutes, shared]);

  if (error) return <ErrorState error={error} onRetry={() => mutate()} title="Could not load live fare rates" />;
  if (isLoading || !meta) return <Skeleton className="h-96 w-full rounded-3xl" />;

  const rates = meta.fare;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form className="card space-y-5 p-6 lg:col-span-2" onSubmit={(e) => e.preventDefault()} aria-label="Fare calculator inputs">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div>
            <label htmlFor="calc-from" className="label">
              From
            </label>
            <select id="calc-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {meta.zones.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
            className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-chip transition hover:bg-brand"
            aria-label="Swap pickup and drop-off"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>
          <div>
            <label htmlFor="calc-to" className="label">
              To
            </label>
            <select id="calc-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              {meta.zones.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="calc-min" className="label flex justify-between">
            <span>Priced trip time</span>
            <span className="text-dark">{minutes} min</span>
          </label>
          <input id="calc-min" type="range" min={1} max={120} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full accent-[#151515]" />
          <p className="mt-1 text-[11px] text-muted">Your real quote uses the time for this distance at current traffic.</p>
        </div>
        <div>
          <label htmlFor="calc-shared" className="label flex justify-between">
            <span>Share of your trip that is pooled</span>
            <span className="text-dark">{shared}%</span>
          </label>
          <input id="calc-shared" type="range" min={0} max={100} step={5} value={shared} onChange={(e) => setShared(Number(e.target.value))} className="w-full accent-[#151515]" />
        </div>
      </form>

      <div className="card p-6 lg:col-span-3" aria-live="polite">
        {!result ? (
          <p className="text-sm text-muted">No published distance for this pair of zones.</p>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">
              {zoneName(from, meta.zones)} → {zoneName(to, meta.zones)} · {result.km} km
            </p>
            <dl className="mt-4 divide-y divide-dark/5 text-sm">
              <div className="flex justify-between py-2.5">
                <dt className="text-muted">Base fare</dt>
                <dd className="font-medium tabular-nums">{formatBdt(result.solo.basePoysha)}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-muted">
                  Distance · {result.km} km × {formatBdt(rates.perKmPoysha)}
                </dt>
                <dd className="font-medium tabular-nums">{formatBdt(result.solo.distanceChargePoysha)}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-muted">
                  Time · {minutes} min × {formatBdt(rates.perMinPoysha)}
                </dt>
                <dd className="font-medium tabular-nums">{formatBdt(result.solo.timeChargePoysha)}</dd>
              </div>
              <div className="flex justify-between py-2.5 font-bold">
                <dt>Standard (solo) fare</dt>
                <dd className="tabular-nums">{formatBdt(result.solo.totalPoysha)}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-2xl bg-brand p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-dark/70">Your pooled fare</p>
                  <p className="text-4xl font-black tabular-nums">{formatBdt(result.pooled)}</p>
                </div>
                <div className="text-right text-xs font-bold">
                  <p>−{result.discountBps / 100}% pool discount</p>
                  <p className="text-dark/70">you save {formatBdt(result.solo.totalPoysha - result.pooled)}</p>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Illustration: the discount grows with the share of your own trip that is pooled, up to {rates.maxPoolDiscountPercent}%. Amounts are integer
              poysha, rounded half-up, exactly like a real quote.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
