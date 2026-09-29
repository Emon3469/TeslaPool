'use client';

import clsx from 'clsx';
import { FlaskConical, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';
import { api } from '@/lib/api';
import { formatBdt, titleCase, zoneName } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import type { EtaPrediction, FarePrediction, Meta, PredictionRequest } from '@/lib/types';

type Result = { eta: EtaPrediction; fare: FarePrediction };
const REASON: Record<string, string> = {
  ML_WITHIN_GUARDRAIL: 'Model accepted: inside the guardrail',
  FARE_GUARDRAIL_TRIGGERED: 'Model rejected: outside the ±band, formula used',
  ETA_GUARDRAIL_TRIGGERED: 'Model rejected: implausible, formula used',
  ML_PREDICTION_UNAVAILABLE: 'Model unavailable: deterministic fallback',
  DETERMINISTIC_PRICING: 'Formula pricing mode: the model is advisory only',
};

/** Where a value sits on the guardrail band, as a % for positioning (band ±50% padding either side). */
function bandPos(v: number, min: number, max: number) {
  const pad = (max - min) * 0.5;
  return Math.min(100, Math.max(0, ((v - (min - pad)) / (max - min + 2 * pad)) * 100));
}

function Marker({ at, label, value, tone }: { at: number; label: string; value: string; tone: 'dark' | 'lime' | 'outline' }) {
  return (
    <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${at}%` }}>
      <span className={clsx('h-6 w-1.5 rounded-full', tone === 'dark' ? 'bg-dark' : tone === 'lime' ? 'bg-brand ring-2 ring-dark' : 'border-2 border-dashed border-dark bg-white')} />
      <span className="mt-1 whitespace-nowrap text-[10px] font-bold">{label}</span>
      <span className="whitespace-nowrap text-[10px] tabular-nums text-muted">{value}</span>
    </div>
  );
}

/**
 * Calls the same ETA and fare pipeline a real ride uses (`POST /predictions/eta`, `/predictions/fare`)
 * and shows the model, its guardrail and the final decision side by side.
 */
export function PredictionLab({ meta }: { meta: Meta }) {
  const { user, isLoading } = useMe();
  const [form, setForm] = useState<PredictionRequest>({
    vehicleType: 'AUTO_RICKSHAW',
    pickupZone: 'BANANI',
    dropoffZone: 'MOHAKHALI',
    traffic: 'HIGH',
    weather: 'CLEAR',
    timeOfDay: 'MORNING_PEAK',
    surgeMultiplier: 1,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [sweep, setSweep] = useState<{ traffic: string; fare: number; minutes: number }[] | null>(null);
  const [busy, setBusy] = useState<'run' | 'sweep' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const set = <K extends keyof PredictionRequest>(k: K, v: PredictionRequest[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function run() {
    setBusy('run');
    setError(null);
    try {
      const [eta, fare] = await Promise.all([api.post<EtaPrediction>('/predictions/eta', form), api.post<FarePrediction>('/predictions/fare', form)]);
      setResult({ eta, fare });
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  async function runSweep() {
    setBusy('sweep');
    setError(null);
    try {
      const rows = await Promise.all(
        meta.enums.traffic.map(async (traffic) => {
          const f = await api.post<FarePrediction>('/predictions/fare', { ...form, traffic });
          return { traffic, fare: f.predictedFare.amountPoysha, minutes: f.predictedDurationMinutes };
        }),
      );
      setSweep(rows);
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  if (!isLoading && !user) {
    return (
      <div className="card flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="flex items-center gap-2 font-black">
            <FlaskConical className="h-5 w-5" aria-hidden="true" /> Prediction lab
          </p>
          <p className="mt-1 text-sm text-muted">Log in to run the live ETA and fare models (rate-limited per account).</p>
        </div>
        <ButtonLink href="/login?next=/intelligence">
          <LogIn className="h-4 w-4" aria-hidden="true" /> Log in to try it
        </ButtonLink>
      </div>
    );
  }

  const fd = result?.fare.fareDecision;
  const maxSweep = sweep ? Math.max(...sweep.map((s) => s.fare)) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <form
        className="card space-y-4 p-5 lg:col-span-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        aria-label="Prediction inputs"
      >
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['pickupZone', 'From'],
              ['dropoffZone', 'To'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label htmlFor={`lab-${k}`} className="label">
                {label}
              </label>
              <select id={`lab-${k}`} className="input px-3 py-2.5" value={form[k]} onChange={(e) => set(k, e.target.value as PredictionRequest[typeof k])}>
                {meta.zones.map((z) => (
                  <option key={z.code} value={z.code}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="lab-vehicle" className="label">
            Vehicle
          </label>
          <select id="lab-vehicle" className="input px-3 py-2.5" value={form.vehicleType} onChange={(e) => set('vehicleType', e.target.value as PredictionRequest['vehicleType'])}>
            {meta.vehicleTypes.map((v) => (
              <option key={v.code} value={v.code}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['traffic', 'Traffic', meta.enums.traffic],
              ['weather', 'Weather', meta.enums.weather],
              ['timeOfDay', 'Time', meta.enums.timeOfDay],
            ] as const
          ).map(([k, label, opts]) => (
            <div key={k}>
              <label htmlFor={`lab-${k}`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                {label}
              </label>
              <select id={`lab-${k}`} className="input px-2 py-2 text-xs" value={form[k]} onChange={(e) => set(k, e.target.value as never)}>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {titleCase(o)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="lab-surge" className="label flex justify-between">
            <span>Surge (model input)</span>
            <span className="text-dark">×{(form.surgeMultiplier ?? 1).toFixed(1)}</span>
          </label>
          <input id="lab-surge" type="range" min={1} max={3} step={0.1} value={form.surgeMultiplier ?? 1} onChange={(e) => set('surgeMultiplier', Number(e.target.value))} className="w-full accent-[#151515]" />
        </div>
        {error !== null && <ErrorState error={error} compact />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy === 'run'} disabled={busy !== null || form.pickupZone === form.dropoffZone}>
            Run models
          </Button>
          <Button variant="outline" onClick={runSweep} loading={busy === 'sweep'} disabled={busy !== null || form.pickupZone === form.dropoffZone}>
            Compare traffic
          </Button>
        </div>
        {form.pickupZone === form.dropoffZone && <p className="text-xs text-red-700">Choose two different areas.</p>}
      </form>

      <div className="space-y-6 lg:col-span-8" aria-live="polite">
        {!result && !sweep && (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-3xl border border-dashed border-dark/15 bg-white/60 p-8 text-center">
            <FlaskConical className="h-8 w-8" aria-hidden="true" />
            <p className="mt-3 font-bold">Run the models to see how a price is decided</p>
            <p className="mt-1 max-w-sm text-sm text-muted">You’ll see the formula’s answer, the model’s answer, and which one the guardrail lets through.</p>
          </div>
        )}

        {result && fd && (
          <div className="grid gap-5 md:grid-cols-2">
            <section className="card p-5" aria-labelledby="eta-h">
              <h3 id="eta-h" className="text-xs font-bold uppercase tracking-wider text-muted">
                ETA · {zoneName(form.pickupZone, meta.zones)} → {zoneName(form.dropoffZone, meta.zones)}
              </h3>
              <p className="mt-2 text-4xl font-black tabular-nums">{Math.round(result.eta.predictedDurationMinutes)} min</p>
              <p className="mt-1 text-xs font-bold">{REASON[result.eta.reason] ?? result.eta.reason}</p>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Formula (distance × min/km)</dt>
                  <dd className="tabular-nums">{result.eta.deterministicMinutes} min</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Model{result.eta.mlPredictedMinutes != null ? ` ${result.eta.modelVersion}` : ' (not used)'}</dt>
                  <dd className="tabular-nums">{result.eta.mlPredictedMinutes == null ? '—' : `${result.eta.mlPredictedMinutes.toFixed(1)} min`}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Distance</dt>
                  <dd className="tabular-nums">
                    {result.eta.distanceKm} km <span className="text-[10px] text-muted">({titleCase(result.eta.distanceSource).toLowerCase()})</span>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="card p-5" aria-labelledby="fare-h">
              <h3 id="fare-h" className="text-xs font-bold uppercase tracking-wider text-muted">
                Fare decision
              </h3>
              <p className="mt-2 text-4xl font-black tabular-nums">{formatBdt(fd.finalFarePoysha)}</p>
              <p className="mt-1 text-xs font-bold">{REASON[fd.reason] ?? fd.reason}</p>
              <div className="relative mt-6 h-16" aria-label="Guardrail band">
                <div className="absolute left-0 right-0 top-2.5 h-1 rounded-full bg-dark/10" />
                <div
                  className="absolute top-1 h-4 rounded-full bg-mint ring-1 ring-dark/15"
                  style={{
                    left: `${bandPos(fd.allowedBand.minPoysha, fd.allowedBand.minPoysha, fd.allowedBand.maxPoysha)}%`,
                    right: `${100 - bandPos(fd.allowedBand.maxPoysha, fd.allowedBand.minPoysha, fd.allowedBand.maxPoysha)}%`,
                  }}
                />
                <Marker at={bandPos(fd.baselineFarePoysha, fd.allowedBand.minPoysha, fd.allowedBand.maxPoysha)} label="Formula" value={formatBdt(fd.baselineFarePoysha)} tone="dark" />
                {fd.mlPredictedFarePoysha != null && (
                  <Marker at={bandPos(fd.mlPredictedFarePoysha, fd.allowedBand.minPoysha, fd.allowedBand.maxPoysha)} label="Model" value={formatBdt(fd.mlPredictedFarePoysha)} tone={fd.source === 'ML' ? 'lime' : 'outline'} />
                )}
              </div>
              <p className="mt-3 text-[11px] text-muted">
                Allowed band {formatBdt(fd.allowedBand.minPoysha)} – {formatBdt(fd.allowedBand.maxPoysha)}. {fd.source === 'ML' ? 'The model set this price.' : 'The published formula set this price.'}
                {fd.deviationBps != null && ` Model deviation ${(fd.deviationBps / 100).toFixed(1)}%.`}
              </p>
            </section>
          </div>
        )}

        {sweep && (
          <section className="card p-5" aria-labelledby="sweep-h">
            <h3 id="sweep-h" className="text-sm font-bold">
              Same trip, every traffic level
            </h3>
            <ul className="mt-4 space-y-3">
              {sweep.map((s) => (
                <li key={s.traffic} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 text-sm">
                  <span className="font-bold">{titleCase(s.traffic)}</span>
                  <span className="h-3 rounded-full bg-dark/5">
                    <span className="block h-3 rounded-full bg-brand ring-1 ring-dark/20" style={{ width: `${(s.fare / maxSweep) * 100}%` }} />
                  </span>
                  <span className="w-32 text-right tabular-nums">
                    <span className="font-black">{formatBdt(s.fare)}</span> <span className="text-xs text-muted">· {Math.round(s.minutes)} min</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted">In the published formula, time is the only line that depends on traffic, so the spread shows what congestion costs a rider.</p>
          </section>
        )}
      </div>
    </div>
  );
}
