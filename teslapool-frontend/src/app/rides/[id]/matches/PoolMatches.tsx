'use client';

import { CheckCircle2, Clock, Route as RouteIcon, Sparkles, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { FareBreakdown } from '@/components/app/FareBreakdown';
import { MatchDecisionCard } from '@/components/app/MatchDecisionCard';
import { MapSwitcher } from '@/components/app/StreetMap';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { formatBdt, formatTime, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import { forgetCreatedRide, readCreatedRide } from '@/lib/quote-cache';
import { rankDecisions } from '@/lib/ride';
import type { AutoMatchResult, MatchDecision, Meta, Ride } from '@/lib/types';

export function PoolMatches({ id }: { id: string }) {
  return (
    <AppPage title="Pool matches" subtitle="Every open pool, checked against your route and everyone already on board." roles={['PASSENGER']} wide>
      {() => <Inner id={id} />}
    </AppPage>
  );
}

function Inner({ id }: { id: string }) {
  const router = useRouter();
  const { data: meta } = useMeta();
  const ride = useSWR<Ride>(`/rides/${id}`, { refreshInterval: 4000 });
  const [cached] = useState(() => (typeof window === 'undefined' ? null : readCreatedRide(id)));

  // Once the ride is matched (here, by a driver, or in another tab) this page has done its job.
  useEffect(() => {
    if (ride.data && ride.data.status !== 'REQUESTED') {
      forgetCreatedRide(id);
      router.replace(`/rides/${id}`);
    }
  }, [ride.data, id, router]);

  if (ride.error) return <ErrorState error={ride.error} onRetry={() => ride.mutate()} title="Could not load this request" />;
  if (!ride.data || !meta) return <LoadingBlock rows={4} label="Loading matches" />;
  if (ride.data.status !== 'REQUESTED') return <LoadingBlock rows={2} label="Opening your ride" />;

  return <Matches ride={ride.data} meta={meta} initialOptions={cached?.ride.poolOptions ?? null} checkedAt={cached?.savedAt ?? null} etaSource={cached?.ride.quote.eta.source} />;
}

function Matches({ ride, meta, initialOptions, checkedAt, etaSource }: { ride: Ride; meta: Meta; initialOptions: MatchDecision[] | null; checkedAt: number | null; etaSource?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [options, setOptions] = useState<MatchDecision[] | null>(initialOptions);
  const [lastCheck, setLastCheck] = useState<number | null>(checkedAt);
  const [auto, setAuto] = useState<AutoMatchResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const rideId = ride.rideRequestId;

  const sorted = useMemo(
    () => rankDecisions(options ?? []),
    [options],
  );
  const feasible = sorted.filter((o) => o.decision === 'MATCHED');
  const focus = sorted.find((o) => o.poolId === selected) ?? feasible[0];

  function done(headline?: string) {
    forgetCreatedRide(rideId);
    toast.success('You’re in the pool', headline);
    router.push(`/rides/${rideId}`);
  }

  async function join(option: MatchDecision) {
    setBusy(option.poolId);
    setError(null);
    try {
      const d = await api.post<MatchDecision>(`/pools/${option.poolId}/join`, { rideRequestId: rideId }, { idempotencyKey: newIdempotencyKey('join') });
      if (d.decision === 'MATCHED') return done(d.fare ? `Your fare: ${formatBdt(d.fare.farePoysha)}` : d.headline);
      // The pool changed since the list was made (e.g. someone took the last seat): show the fresh verdict.
      setOptions((all) => (all ?? []).map((o) => (o.poolId === d.poolId ? d : o)));
      setError(new ApiError(409, d.reasonCodes[0] ?? 'NOT_MATCHED', d.headline));
    } catch (err) {
      setError(err);
    }
    setBusy(null);
  }

  async function bestMatch() {
    setBusy('auto');
    setError(null);
    try {
      const r = await api.post<AutoMatchResult>(`/rides/${rideId}/match`, undefined, { idempotencyKey: newIdempotencyKey('match') });
      if (r.decision === 'MATCHED') return done(r.match?.headline);
      setAuto(r);
      setOptions(r.candidates);
      setLastCheck(Date.now());
    } catch (err) {
      setError(err);
    }
    setBusy(null);
  }

  async function cancel() {
    setBusy('cancel');
    try {
      await api.post(`/rides/${rideId}/cancel`, { reason: 'Changed my mind before matching' }, { idempotencyKey: newIdempotencyKey('cancel') });
      forgetCreatedRide(rideId);
      toast.info('Request cancelled', 'You were not charged.');
      router.push('/ride/new');
    } catch (err) {
      toast.error('Could not cancel', errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <aside className="space-y-5 lg:col-span-5">
        <div className="on-lime rounded-3xl bg-brand p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-dark/70">
            {zoneName(ride.pickup.zone, meta.zones)} → {zoneName(ride.dropoff.zone, meta.zones)} · {ride.requestedSeats} seat{ride.requestedSeats > 1 ? 's' : ''}
          </p>
          <p className="mt-2 text-5xl font-black tabular-nums tracking-tight">{formatBdt(ride.estimatedFare.amountPoysha)}</p>
          <p className="mt-1 text-sm font-medium text-dark/75">Your solo quote, the most you’ll pay. Pooling lowers it.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" /> ~{Math.round(ride.estimatedDurationMinutes)} min{etaSource === 'ML' ? ' (ML)' : ''}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1">
              <RouteIcon className="h-3.5 w-3.5" aria-hidden="true" /> {ride.estimatedDistanceKm} km
            </span>
            <span className="rounded-full bg-white/70 px-2.5 py-1">{ride.paymentMethod === 'TESLAPAY' ? 'TeslaPay' : 'Cash'}</span>
          </div>
        </div>
        {ride.fareBreakdown && (
          <div className="card p-5">
            <h2 className="mb-2 text-sm font-bold">How this price is made</h2>
            <FareBreakdown breakdown={ride.fareBreakdown} />
            <p className="mt-3 text-[11px] text-muted">{ride.fareSource === 'ML' ? 'Priced by the fare model within its guardrail.' : 'Priced by the published formula.'}</p>
          </div>
        )}
        <div className="card p-4">
          <MapSwitcher
            zones={meta.zones}
            pickup={ride.pickup.zone}
            dropoff={ride.dropoff.zone}
            pickupPoint={ride.pickup.lat != null && ride.pickup.lng != null ? { lat: ride.pickup.lat, lng: ride.pickup.lng } : null}
            dropoffPoint={ride.dropoff.lat != null && ride.dropoff.lng != null ? { lat: ride.dropoff.lat, lng: ride.dropoff.lng } : null}
            route={focus?.route}
            heightClass="h-72"
          />
          {focus && <p className="mt-2 px-1 text-xs text-muted">Showing the route of the {focus === feasible[0] && !selected ? 'best' : 'selected'} pool.</p>}
        </div>
        <Button variant="danger" className="w-full" onClick={cancel} loading={busy === 'cancel'} disabled={busy !== null && busy !== 'cancel'}>
          Cancel request
        </Button>
      </aside>

      <section className="space-y-4 lg:col-span-7" aria-labelledby="pools-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="pools-h" className="text-xl font-black">
              {options === null ? 'Ready to match' : feasible.length > 0 ? `${feasible.length} pool${feasible.length > 1 ? 's' : ''} can take you` : 'No open pool fits right now'}
            </h2>
            <p className="text-sm text-muted">
              {options === null
                ? 'Check live pools now, or wait for a driver to accept you.'
                : `${sorted.length} checked${lastCheck ? ` at ${formatTime(new Date(lastCheck).toISOString())}` : ''}. Pools change as riders join; joining re-checks everything.`}
            </p>
          </div>
          <Button variant="dark" onClick={bestMatch} loading={busy === 'auto'} disabled={busy !== null && busy !== 'auto'}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> {options === null ? 'Check pools now' : 'Best match for me'}
          </Button>
        </div>

        {sorted.length > 0 && (
          <div className="flex flex-wrap gap-3 rounded-2xl bg-white/70 p-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold">
              <CheckCircle2 className="h-4 w-4 text-lime-600" aria-hidden="true" /> {feasible.length} can take you
            </span>
            <span className="inline-flex items-center gap-1.5 font-bold">
              <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" /> {sorted.length - feasible.length} can’t (reasons inside)
            </span>
          </div>
        )}

        {error !== null && <ErrorState error={error} compact />}
        {auto && auto.decision === 'REJECTED' && (
          <p role="status" className="rounded-2xl bg-cream p-4 text-sm">
            <span className="font-bold">No pool can take you right now.</span> Your request stays open: a driver on your route can accept you.
          </p>
        )}

        {options !== null && sorted.length === 0 ? (
          <EmptyState title="No Teslas are pooling right now" body="Your request is open. Drivers who come online see it and can accept you." icon={<Sparkles className="h-6 w-6" aria-hidden="true" />} />
        ) : (
          sorted.map((o, i) => (
            <div key={o.poolId} onMouseEnter={() => setSelected(o.poolId)} onFocus={() => setSelected(o.poolId)}>
              <MatchDecisionCard
                decision={o}
                zones={meta.zones}
                title={`Pool ${i + 1}${o.decision === 'MATCHED' && o === feasible[0] ? ' · best fit' : ''}`}
                defaultOpen={o.decision !== 'MATCHED' && feasible.length === 0}
                action={
                  o.decision === 'MATCHED' ? (
                    <Button className="w-full sm:w-auto" onClick={() => join(o)} loading={busy === o.poolId} disabled={busy !== null && busy !== o.poolId}>
                      Join this pool
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ))
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-dark/15 p-4 text-sm">
          <span className="text-muted">Prefer to wait? Drivers on your route can accept your request directly.</span>
          <ButtonLink href={`/rides/${ride.rideRequestId}`} variant="outline" size="sm">
            Track my request
          </ButtonLink>
        </div>
        <p className="text-xs text-muted">
          Wrong trip?{' '}
          <Link href="/ride/new" className="font-bold underline-offset-2 hover:underline" onClick={(e) => { e.preventDefault(); void cancel(); }}>
            Cancel and start over
          </Link>
        </p>
      </section>
    </div>
  );
}
