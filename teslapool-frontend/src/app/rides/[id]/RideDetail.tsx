'use client';

import clsx from 'clsx';
import { Check, Clock, ExternalLink, LogOut, Printer, RefreshCw, ShieldAlert, Sparkles, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { FareBreakdown } from '@/components/app/FareBreakdown';
import { RideStepper } from '@/components/app/RideStepper';
import { RideEventLog } from '@/components/app/RideEventLog';
import { MapSwitcher } from '@/components/app/StreetMap';
import { Button, ButtonLink } from '@/components/ui/Button';
import { PhasePill } from '@/components/ui/Pills';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { formatBdt, formatDateTime, formatTime, money, routeLabel, VEHICLE_LABEL, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import { canCancel, canLeavePool, isActive, nextDriverAction, pollInterval } from '@/lib/ride';
import type { AutoMatchResult, Ride, RideExplanation, User } from '@/lib/types';

export function RideDetail({ id }: { id: string }) {
  return <AppPage title="Your ride">{(user) => <RideDetailInner id={id} user={user} />}</AppPage>;
}

function RideDetailInner({ id, user }: { id: string; user: User }) {
  const toast = useToast();
  const { data: meta } = useMeta();
  const ride = useSWR<Ride>(`/rides/${id}`, { refreshInterval: (r) => pollInterval(r?.phase), refreshWhenHidden: false });
  const expl = useSWR<RideExplanation>(ride.data ? `/rides/${id}/explanation` : null, { refreshInterval: pollInterval(ride.data?.phase) });
  const [busy, setBusy] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<AutoMatchResult | null>(null);

  if (ride.error) {
    const e = ride.error;
    const title = e instanceof ApiError && e.status === 404 ? 'Ride not found' : e instanceof ApiError && e.status === 403 ? 'This ride belongs to someone else' : 'Could not load this ride';
    return (
      <div className="space-y-4">
        <ErrorState error={e} onRetry={() => ride.mutate()} title={title} />
        <ButtonLink href="/rides" variant="outline">
          Back to my rides
        </ButtonLink>
      </div>
    );
  }
  if (!ride.data) return <LoadingBlock label="Loading ride" rows={4} />;

  const r = ride.data;
  const x = expl.data;
  const zones = meta?.zones;
  const isOwner = user.role === 'PASSENGER';
  const isAdmin = user.role === 'ADMIN';
  const adminNext = isAdmin ? nextDriverAction(r.status) : null;
  const refresh = () => Promise.all([ride.mutate(), expl.mutate()]);

  async function act(kind: 'cancel' | 'leave' | 'match' | 'arrive' | 'start' | 'complete') {
    setBusy(kind);
    try {
      if (kind === 'cancel') {
        await api.post(`/rides/${id}/cancel`, { reason: isAdmin ? 'Cancelled by operations' : 'Cancelled by passenger' }, { idempotencyKey: newIdempotencyKey('cancel') });
        toast.info('Ride cancelled', 'You were not charged.');
      } else if (kind === 'leave' && r.pool) {
        await api.post(`/pools/${r.pool.poolId}/leave`, undefined, { idempotencyKey: newIdempotencyKey('leave') });
        toast.info('You left the pool', 'Your request is open again.');
      } else if (kind === 'match') {
        const m = await api.post<AutoMatchResult>(`/rides/${id}/match`, undefined, { idempotencyKey: newIdempotencyKey('match') });
        setMatchResult(m);
        if (m.decision === 'MATCHED') toast.success('Matched!', m.match?.headline);
      } else {
        await api.post(`/rides/${id}/${kind}`, undefined, { idempotencyKey: newIdempotencyKey(kind) });
        toast.success('Ride updated', `Moved on by operations (${kind}).`);
      }
      await refresh();
    } catch (err) {
      toast.error('That didn’t work', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const trip = x?.trip ?? null;
  const fare = x?.fare;
  const route = trip?.route ?? [];
  const paidOrFinal = r.payment?.amount ?? r.finalFare;

  return (
    <div className="space-y-6">
      <div className="card p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <PhasePill phase={r.phase} status={r.status} />
            <span className="text-sm text-muted">
              {zoneName(r.pickup.zone, zones)} → {zoneName(r.dropoff.zone, zones)} · {r.requestedSeats} seat{r.requestedSeats > 1 ? 's' : ''} · {VEHICLE_LABEL[r.vehicleType] ?? r.vehicleType}
            </span>
          </div>
          <span className="flex items-center gap-2 text-xs text-muted">
            {isActive(r.status) && (
              <>
                <RefreshCw className={clsx('h-3.5 w-3.5', ride.isValidating && 'animate-spin')} aria-hidden="true" /> Live
              </>
            )}
            <span>Requested {formatDateTime(r.createdAt)}</span>
          </span>
        </div>
        <RideStepper status={r.status} />
      </div>

      {isAdmin && (canCancel(r.status) || adminNext) && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-3xl border-2 border-dashed border-dark/20 bg-white p-5 sm:flex-row sm:items-center">
          <p className="flex items-center gap-2 text-sm font-bold">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Operations controls
            <span className="font-normal text-muted">Every action is recorded in the ride’s timeline.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {r.status === 'REQUESTED' && (
              <Button size="sm" variant="dark" onClick={() => act('match')} loading={busy === 'match'} disabled={busy !== null}>
                Auto-match
              </Button>
            )}
            {adminNext && (
              <Button size="sm" onClick={() => act(adminNext.action)} loading={busy === adminNext.action} disabled={busy !== null}>
                {adminNext.label}
              </Button>
            )}
            {canCancel(r.status) && (
              <Button size="sm" variant="danger" onClick={() => act('cancel')} loading={busy === 'cancel'} disabled={busy !== null}>
                Cancel ride
              </Button>
            )}
          </div>
        </div>
      )}

      {r.status === 'REQUESTED' && isOwner && (
        <div className="on-lime flex flex-col items-start justify-between gap-4 rounded-3xl bg-brand p-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-lg font-black">Looking for a pool…</p>
            <p className="text-sm text-dark/75">
              Drivers on your route can see and accept your request. {matchResult?.decision === 'REJECTED' && `No pool fits right now (${matchResult.candidatesEvaluated} checked).`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/rides/${id}/matches`} variant="outline" className="border-dark/30">
              See pool matches
            </ButtonLink>
            <Button variant="dark" onClick={() => act('match')} loading={busy === 'match'} disabled={busy !== null}>
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Try matching now
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <section className="card p-5 sm:p-6" aria-labelledby="trip-h">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="trip-h" className="text-lg font-black">
                Trip
              </h2>
              {r.pool && (
                <Link href={`/pools/${r.pool.poolId}`} className="inline-flex items-center gap-1 rounded-lg text-sm font-bold underline-offset-2 hover:underline">
                  Open pool view <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
            {zones && (
              <div className="mb-5">
                <MapSwitcher
                  zones={zones}
                  pickup={r.pickup.zone}
                  dropoff={r.dropoff.zone}
                  pickupPoint={r.pickup.lat != null && r.pickup.lng != null ? { lat: r.pickup.lat, lng: r.pickup.lng } : null}
                  dropoffPoint={r.dropoff.lat != null && r.dropoff.lng != null ? { lat: r.dropoff.lat, lng: r.dropoff.lng } : null}
                  route={route.length > 1 ? route : undefined}
                  heightClass="h-72 sm:h-80"
                />
              </div>
            )}
            {trip ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-cream p-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-dark text-lg font-black text-brand">{trip.driverFirstName.charAt(0)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {trip.driverFirstName} · {trip.vehicle.name}
                    </p>
                    <p className="text-sm text-muted">
                      {VEHICLE_LABEL[trip.vehicle.vehicleType] ?? trip.vehicle.vehicleType} · <span className="font-mono">{trip.vehicle.registrationNumber}</span>
                    </p>
                  </div>
                </div>
                <ol className="space-y-2" aria-label="Stops">
                  {route.map((z, i) => {
                    const mine = i + 1 === trip.yourPickup.stopNumber ? 'Your pickup' : i + 1 === trip.yourDropoff.stopNumber ? 'Your drop-off' : null;
                    return (
                      <li key={`${z}-${i}`} className="flex items-center gap-3 text-sm">
                        <span className={clsx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-black', mine ? 'bg-brand ring-2 ring-dark' : 'bg-chip')}>{i + 1}</span>
                        <span className={mine ? 'font-bold' : ''}>{zoneName(z, zones)}</span>
                        {mine && <span className="badge-tag bg-mint px-2 py-0.5 text-[10px] font-bold">{mine}</span>}
                      </li>
                    );
                  })}
                </ol>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" /> Sharing with
                  </p>
                  {trip.coPassengers.length === 0 ? (
                    <p className="text-sm text-muted">{isActive(r.status) && r.status !== 'STARTED' ? 'Nobody yet. Your fare drops if a compatible rider joins before pickup.' : 'Nobody shared this trip.'}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {trip.coPassengers.map((p, i) => (
                        <li key={i} className="rounded-2xl border-subtle bg-white px-3 py-2 text-sm">
                          <span className="font-bold">{p.firstName}</span>
                          <span className="text-muted">
                            {' '}
                            · {p.seats} seat{p.seats > 1 ? 's' : ''} · {p.pickup} → {p.dropoff}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">{r.status === 'CANCELLED' ? 'No trip: this ride was cancelled.' : 'Your driver and route appear here once you are matched.'}</p>
            )}
          </section>

          {x?.match && (
            <section className="card p-5 sm:p-6" aria-labelledby="why-h">
              <h2 id="why-h" className="text-lg font-black">
                Why you were matched
              </h2>
              <p className="mt-1 text-sm text-muted">
                {x.match.headline} · {x.match.initiatedBy === 'DRIVER' ? 'accepted by your driver' : 'you joined'} at {formatTime(x.match.matchedAt)}
              </p>
              <ul className="mt-4 space-y-2">
                {x.match.reasons.map((c) => (
                  <li key={c.rule} className="flex items-start gap-2.5 text-sm">
                    {c.passed ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-lime-600" aria-label="passed" /> : <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-label="failed" />}
                    {c.message}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                Route at match: {routeLabel(x.match.routeAtMatch, zones)} · your detour {x.match.detourKmAtMatch} km
              </p>
            </section>
          )}

          {x && x.rejections.length > 0 && (
            <section className="card p-5 sm:p-6" aria-labelledby="rej-h">
              <h2 id="rej-h" className="text-lg font-black">
                Pools that couldn’t take you
              </h2>
              <ul className="mt-3 space-y-3">
                {x.rejections.map((j, i) => (
                  <li key={i} className="rounded-2xl bg-cream p-3 text-sm">
                    <p className="font-bold">{j.headline}</p>
                    {j.reasons.length > 0 && <p className="mt-0.5 text-muted">{j.reasons.join(' · ')}</p>}
                    <p className="mt-1 text-[11px] text-muted">{formatTime(j.at)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-6 lg:col-span-5">
          <section className="card overflow-hidden" aria-labelledby="fare-h">
            <div className={clsx('p-5 sm:p-6', r.status === 'COMPLETED' ? 'on-lime bg-brand' : 'bg-dark text-white')}>
              <h2 id="fare-h" className={clsx('text-xs font-bold uppercase tracking-wider', r.status === 'COMPLETED' ? 'text-dark/70' : 'text-white/60')}>
                {r.status === 'COMPLETED' ? (r.payment ? `Paid · ${r.payment.method === 'TESLAPAY' ? 'TeslaPay' : 'Cash'}` : 'Final fare') : fare?.pooled?.locked ? 'Your fare (locked)' : 'Your fare right now'}
              </h2>
              <p className="mt-1 text-5xl font-black tabular-nums tracking-tight">
                {paidOrFinal ? money(paidOrFinal) : r.pool ? money(r.pool.fare) : money(r.estimatedFare)}
              </p>
              {r.pool && r.pool.discountPercent > 0 && (
                <p className={clsx('mt-1 text-sm font-medium', r.status === 'COMPLETED' ? 'text-dark/75' : 'text-brand')}>
                  {r.pool.discountPercent}% pool discount · you save {formatBdt(r.pool.soloFare.amountPoysha - r.pool.fare.amountPoysha)}
                </p>
              )}
              {!r.pool && r.status !== 'CANCELLED' && <p className="mt-1 text-sm text-white/60">Solo quote. Pooling can only lower it.</p>}
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              {r.fareBreakdown && <FareBreakdown breakdown={r.fareBreakdown} />}
              {fare && fare.lines.length > 0 && (
                <ul className="space-y-1.5 rounded-2xl bg-cream p-4 text-xs leading-relaxed text-dark/80">
                  {fare.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 print:hidden">
                {isOwner && canLeavePool(r.status) && r.pool && (
                  <Button variant="outline" size="sm" onClick={() => act('leave')} loading={busy === 'leave'} disabled={busy !== null}>
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Leave pool
                  </Button>
                )}
                {isOwner && canCancel(r.status) && (
                  <Button variant="danger" size="sm" onClick={() => act('cancel')} loading={busy === 'cancel'} disabled={busy !== null}>
                    Cancel ride
                  </Button>
                )}
                {r.status === 'COMPLETED' && (
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" aria-hidden="true" /> Print receipt
                  </Button>
                )}
              </div>
            </div>
          </section>

          {x && x.summary.length > 0 && (
            <section className="card p-5 sm:p-6" aria-labelledby="sum-h">
              <h2 id="sum-h" className="mb-3 text-lg font-black">
                In plain words
              </h2>
              <ul className="space-y-2 text-sm leading-relaxed text-dark/80">
                {x.summary.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-dark" aria-hidden="true" />
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {x && x.timeline.length > 0 && (
            <section className="card p-5 sm:p-6" aria-labelledby="tl-h">
              <h2 id="tl-h" className="mb-4 flex items-center gap-2 text-lg font-black">
                <Clock className="h-4 w-4" aria-hidden="true" /> Timeline
              </h2>
              <ol className="relative space-y-4 border-l-2 border-dark/10 pl-5">
                {x.timeline.map((t, i) => (
                  <li key={i} className="relative">
                    <span className={clsx('absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white', i === x.timeline.length - 1 ? 'bg-brand' : 'bg-dark')} aria-hidden="true" />
                    <p className="text-sm">{t.description}</p>
                    <time dateTime={t.at} className="text-[11px] text-muted">
                      {formatDateTime(t.at)}
                    </time>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-[11px] text-muted">This history is append-only: it can’t be edited or deleted.</p>
            </section>
          )}
          {expl.error && <ErrorState error={expl.error} compact onRetry={() => expl.mutate()} />}
          <RideEventLog rideId={id} live={isActive(r.status)} />
        </div>
      </div>

      <div className="print:hidden">
        <Link href={user.role === 'DRIVER' ? '/driver' : '/rides'} className="text-sm font-bold text-dark/70 hover:text-dark">
          ← {user.role === 'DRIVER' ? 'Back to dashboard' : isAdmin ? 'All rides' : 'All my rides'}
        </Link>
      </div>
    </div>
  );
}
