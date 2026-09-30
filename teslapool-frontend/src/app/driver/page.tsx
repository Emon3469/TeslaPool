'use client';

import clsx from 'clsx';
import { Clock, Power, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { MatchDecisionCard } from '@/components/app/MatchDecisionCard';
import { MapSwitcher } from '@/components/app/StreetMap';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage, newIdempotencyKey } from '@/lib/api';
import { FLEXIBILITY_LABEL, formatWait, money, RIDE_STATUS_LABEL, VEHICLE_LABEL, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import { nextDriverAction } from '@/lib/ride';
import type { CompatibleRequest, DriverStatus, MatchDecision, Pool, RideStatus, User } from '@/lib/types';

export default function DriverDashboardPage() {
  return (
    <AppPage title="Driver dashboard" subtitle="Go online, accept riders on your route, and move each passenger through their trip." roles={['DRIVER']} wide>
      {(user) => <Dashboard user={user} />}
    </AppPage>
  );
}

function Dashboard({ user }: { user: User }) {
  const { data, error, mutate } = useSWR<DriverStatus>('/driver/status', { refreshInterval: 5000 });
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <LoadingBlock label="Loading your status" rows={3} />;
  return data.online && data.pool ? <OnlinePanel status={data} pool={data.pool} refresh={() => mutate()} /> : <OfflinePanel status={data} user={user} refresh={() => mutate()} />;
}

function FlexBadge({ value }: { value: string }) {
  return (
    <span className={clsx('ml-1.5 inline-flex rounded-full px-2 py-0.5 align-middle text-[10px] font-black uppercase tracking-wider', value === 'URGENT' ? 'bg-red-600 text-white' : 'bg-mint text-dark')}>
      {FLEXIBILITY_LABEL[value]?.label ?? value}
    </span>
  );
}

function OfflinePanel({ status, user, refresh }: { status: DriverStatus; user: User; refresh: () => Promise<unknown> }) {
  const toast = useToast();
  const active = status.vehicles.filter((v) => v.isActive);
  const [vehicleId, setVehicleId] = useState(active[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (!vehicleId && active[0]) setVehicleId(active[0].id);
  }, [active, vehicleId]);

  async function goOnline() {
    setBusy(true);
    setErr(null);
    try {
      await api.post('/driver/online', { vehicleId });
      toast.success('You’re online', 'Your pool is open to riders on your route.');
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  if (active.length === 0) {
    return (
      <EmptyState
        title="Register a vehicle to start driving"
        body="Add your Tesla with its seat count and registration number. Then you can go online."
        action={<ButtonLink href="/driver/vehicles">Add a vehicle</ButtonLink>}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="card p-6 sm:p-8 lg:col-span-7">
        <span className="inline-flex items-center gap-2 rounded-full bg-chip px-3 py-1 text-xs font-bold">
          <span className="h-2 w-2 rounded-full bg-dark/30" aria-hidden="true" /> Offline
        </span>
        <h2 className="mt-4 text-2xl font-black">Ready to fill some seats, {user.name.split(' ')[0]}?</h2>
        <p className="mt-1 text-sm text-muted">Pick the vehicle you’re driving. Going online opens a pool that riders on your route can join.</p>
        <fieldset className="mt-6">
          <legend className="label">Vehicle</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map((v) => (
              <label
                key={v.id}
                className={clsx(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 p-4 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/60',
                  vehicleId === v.id ? 'border-dark bg-brand' : 'border-dark/10 hover:border-dark/30',
                )}
              >
                <input type="radio" name="vehicle" className="sr-only" checked={vehicleId === v.id} onChange={() => setVehicleId(v.id)} />
                <span>
                  <span className="block font-bold">{v.name}</span>
                  <span className="block text-xs text-dark/60">{VEHICLE_LABEL[v.vehicleType] ?? v.vehicleType}</span>
                </span>
                <span className="text-sm font-black">{v.capacity} seats</span>
              </label>
            ))}
          </div>
        </fieldset>
        {err !== null && <div className="mt-4"><ErrorState error={err} compact /></div>}
        <Button size="lg" className="mt-6 w-full sm:w-auto" onClick={goOnline} loading={busy} disabled={!vehicleId}>
          <Power className="h-4 w-4" aria-hidden="true" /> Go online
        </Button>
      </div>
      <div className="on-lime rounded-3xl bg-brand p-6 sm:p-8 lg:col-span-5">
        <h3 className="text-lg font-black">How your day works</h3>
        <ol className="mt-4 space-y-3 text-sm font-medium text-dark/80">
          <li>1. Go online: your vehicle opens a pool.</li>
          <li>2. Accept compatible riders, or let them join.</li>
          <li>3. Follow the stop order: arrive, start, complete for each rider.</li>
          <li>4. When the last rider is dropped off, you’re offline and free to go again.</li>
        </ol>
        <Link href="/driver/history" className="mt-6 inline-block text-sm font-bold underline-offset-2 hover:underline">
          See past trips →
        </Link>
      </div>
    </div>
  );
}

function OnlinePanel({ status, pool, refresh }: { status: DriverStatus; pool: Pool; refresh: () => Promise<unknown> }) {
  const toast = useToast();
  const { data: meta } = useMeta();
  const [busy, setBusy] = useState<string | null>(null);
  // Keep listing waiting riders even when full: the driver sees who is waiting and why they can't join yet.
  const requests = useSWR<CompatibleRequest[]>(`/pools/${pool.id}/requests`, { refreshInterval: 5000 });
  const joinable = requests.data?.filter((r) => r.decision.decision === 'MATCHED').length ?? 0;
  const zones = meta?.zones;
  const live = pool.passengers.filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED');

  async function step(rideId: string, action: 'arrive' | 'start' | 'complete', name: string) {
    setBusy(rideId);
    try {
      await api.post(`/rides/${rideId}/${action}`, undefined, { idempotencyKey: newIdempotencyKey(action) });
      toast.success(action === 'arrive' ? `Arrived for ${name}` : action === 'start' ? `Trip started with ${name}` : `Dropped off ${name}`);
      await refresh();
    } catch (e) {
      toast.error('Could not update the ride', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function accept(r: CompatibleRequest) {
    setBusy(r.rideRequestId);
    try {
      const d = await api.post<MatchDecision>(`/pools/${pool.id}/accept`, { rideRequestId: r.rideRequestId }, { idempotencyKey: newIdempotencyKey('accept') });
      if (d.decision === 'MATCHED') toast.success(`${r.passengerFirstName} joined your pool`);
      else toast.error('Could not accept', d.headline);
      await Promise.all([refresh(), requests.mutate()]);
    } catch (e) {
      toast.error('Could not accept', errorMessage(e));
      await requests.mutate();
    } finally {
      setBusy(null);
    }
  }

  async function goOffline() {
    setBusy('offline');
    try {
      await api.post('/driver/offline');
      toast.info('You’re offline');
      await refresh();
    } catch (e) {
      toast.error('Can’t go offline yet', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const pct = Math.round((pool.occupiedSeats / pool.capacity) * 100);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="card p-5 sm:p-6 lg:col-span-7" aria-labelledby="pool-h">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1 text-xs font-bold">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-dark opacity-40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-dark" />
                </span>
                Online · {pool.status.toLowerCase().replace('_', ' ')}
              </span>
              <h2 id="pool-h" className="mt-3 text-2xl font-black">
                {pool.vehicle.name}
              </h2>
              <Link href={`/pools/${pool.id}`} className="text-xs font-bold underline-offset-2 hover:underline">
                Open pool view →
              </Link>
              <p className="text-sm text-muted">
                {VEHICLE_LABEL[pool.vehicle.vehicleType] ?? pool.vehicle.vehicleType} · <span className="font-mono">{pool.vehicle.registrationNumber}</span>
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={goOffline} loading={busy === 'offline'} disabled={busy !== null || live.length > 0} title={live.length > 0 ? 'Finish your passengers’ trips first' : undefined}>
              <Power className="h-4 w-4" aria-hidden="true" /> Go offline
            </Button>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex justify-between text-xs font-bold">
              <span>Seats</span>
              <span className="tabular-nums">
                {pool.occupiedSeats} / {pool.capacity} taken
              </span>
            </div>
            <div className="flex h-3 gap-1" role="img" aria-label={`${pool.occupiedSeats} of ${pool.capacity} seats taken`}>
              {Array.from({ length: pool.capacity }, (_, i) => (
                <span key={i} className={clsx('flex-1 rounded-full transition-colors', i < pool.occupiedSeats ? 'bg-dark' : 'bg-dark/10')} />
              ))}
            </div>
            <p className="sr-only">{pct}% full</p>
          </div>

          {pool.route.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Stop order · {pool.totalDistanceKm} km</p>
              <ol className="flex flex-wrap items-center gap-2">
                {pool.route.map((z, i) => (
                  <li key={`${z}-${i}`} className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-full bg-cream px-3 py-1.5 text-sm font-bold">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-dark text-[10px] text-brand">{i + 1}</span>
                      {zoneName(z, zones)}
                    </span>
                    {i < pool.route.length - 1 && <span aria-hidden="true">→</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mt-6">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Passengers
            </p>
            {pool.passengers.length === 0 ? (
              <p className="rounded-2xl bg-cream p-4 text-sm text-muted">No passengers yet. Accept a request on the right, or wait for riders to join.</p>
            ) : (
              <ul className="space-y-3">
                {pool.passengers.map((p) => {
                  const next = nextDriverAction(p.status);
                  return (
                    <li key={p.rideRequestId ?? p.firstName} className="flex flex-wrap items-center gap-3 rounded-2xl border-subtle p-4">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-mint font-black">{p.firstName.charAt(0)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">
                          {p.firstName} <span className="font-normal text-muted">· {p.seats} seat{p.seats > 1 ? 's' : ''}</span>
                          {p.flexibility !== 'STANDARD' && <FlexBadge value={p.flexibility} />}
                        </p>
                        <p className="text-xs text-muted">
                          stop {p.pickupSequence + 1} {p.pickupZone} → stop {p.dropoffSequence + 1} {p.dropoffZone} · {money(p.fare)}
                        </p>
                      </div>
                      <span className="badge-tag text-[11px] font-bold">{RIDE_STATUS_LABEL[p.status as RideStatus] ?? p.status}</span>
                      {next && p.rideRequestId && (
                        <Button size="sm" variant={next.action === 'complete' ? 'dark' : 'lime'} onClick={() => step(p.rideRequestId!, next.action, p.firstName)} loading={busy === p.rideRequestId} disabled={busy !== null}>
                          {next.label}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <div className="space-y-6 lg:col-span-5">
          {zones && (
            <div className="card p-4">
              <MapSwitcher zones={zones} route={pool.route.length > 1 ? pool.route : undefined} heightClass="h-72" />
            </div>
          )}
          <section className="card p-5 sm:p-6" aria-labelledby="req-h">
            <h2 id="req-h" className="flex items-center gap-2 text-lg font-black">
              <UserPlus className="h-5 w-5" aria-hidden="true" /> Riders waiting on your route
            </h2>
            <p className="mt-1 text-xs text-muted">Best fits first. Accepting runs the same checks as a passenger joining.</p>
            <div className="mt-4 space-y-3">
              {pool.availableSeats === 0 && (
                <p role="status" className="rounded-2xl bg-dark p-4 text-sm text-white">
                  <span className="font-bold text-brand">All {pool.capacity} seats are taken.</span> New riders can’t join unless someone leaves or cancels before pickup; each waiting rider below shows exactly why. They stay open for another driver.
                </p>
              )}
              {pool.availableSeats > 0 && requests.data && requests.data.length > 0 && joinable === 0 && (
                <p className="rounded-2xl bg-cream p-4 text-sm">Riders are waiting, but none fits your route and seats right now. Open “Why?” on each for the reason.</p>
              )}
              {requests.error ? (
                <ErrorState error={requests.error} compact onRetry={() => requests.mutate()} />
              ) : !requests.data ? (
                <LoadingBlock rows={2} />
              ) : requests.data.length === 0 ? (
                <p className="rounded-2xl bg-cream p-4 text-sm text-muted">No waiting riders right now. This list refreshes every few seconds.</p>
              ) : (
                requests.data.map((r) => (
                  <MatchDecisionCard
                    key={r.rideRequestId}
                    decision={r.decision}
                    zones={zones}
                    title={
                      <span className="flex items-center gap-2 normal-case tracking-normal">
                        <span className="text-dark">{r.passengerFirstName}</span>
                        {r.flexibility !== 'STANDARD' && <FlexBadge value={r.flexibility} />} · {r.requestedSeats} seat{r.requestedSeats > 1 ? 's' : ''} · {zoneName(r.pickupZone, zones)} → {zoneName(r.dropoffZone, zones)}
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" /> {formatWait(r.waitingSeconds)}
                        </span>
                      </span>
                    }
                    action={
                      r.decision.decision === 'MATCHED' ? (
                        <Button size="sm" onClick={() => accept(r)} loading={busy === r.rideRequestId} disabled={busy !== null}>
                          Accept {r.passengerFirstName}
                        </Button>
                      ) : undefined
                    }
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
      <p className="text-xs text-muted">Vehicles on file: {status.vehicles.map((v) => v.name).join(', ')}</p>
    </div>
  );
}
