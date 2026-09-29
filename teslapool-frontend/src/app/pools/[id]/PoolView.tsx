'use client';

import clsx from 'clsx';
import { Ban, Car, RefreshCw, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { MapSwitcher } from '@/components/app/StreetMap';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDateTime, money, RIDE_STATUS_LABEL, titleCase, VEHICLE_LABEL, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import type { Pool, RideStatus, User } from '@/lib/types';

const LIVE = ['OPEN', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

export function PoolView({ id }: { id: string }) {
  return <AppPage title="Pool">{(user) => <Inner id={id} user={user} />}</AppPage>;
}

function Inner({ id, user }: { id: string; user: User }) {
  const toast = useToast();
  const { data: meta } = useMeta();
  const { data: pool, error, mutate, isValidating } = useSWR<Pool>(`/pools/${id}`, { refreshInterval: (p) => (p && LIVE.includes(p.status) ? 5000 : 0) });
  const [busy, setBusy] = useState(false);

  if (error) {
    const title = error instanceof ApiError && error.status === 403 ? 'You are not part of this pool' : error instanceof ApiError && error.status === 404 ? 'Pool not found' : 'Could not load this pool';
    return <ErrorState error={error} onRetry={() => mutate()} title={title} />;
  }
  if (!pool) return <LoadingBlock rows={3} label="Loading pool" />;

  const zones = meta?.zones;
  const isDriver = pool.driverId === user.id;
  const canCancelPool = (isDriver || user.role === 'ADMIN') && pool.status === 'OPEN' && pool.occupiedSeats === 0;
  const live = LIVE.includes(pool.status);
  const mine = pool.passengers.find((p) => p.rideRequestId);

  async function cancelPool() {
    setBusy(true);
    try {
      await api.post(`/pools/${id}/cancel`);
      toast.info('Pool closed', isDriver ? 'You are now offline.' : 'The empty pool was cancelled.');
      await mutate();
    } catch (e) {
      toast.error('Could not close the pool', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand">
            <Car className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-2xl font-black">{pool.vehicle.name}</p>
            <p className="text-sm text-muted">
              {VEHICLE_LABEL[pool.vehicle.vehicleType] ?? pool.vehicle.vehicleType} · <span className="font-mono">{pool.vehicle.registrationNumber}</span> · opened {formatDateTime(pool.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={clsx('rounded-full px-3 py-1 text-xs font-bold', live ? 'bg-brand' : pool.status === 'CANCELLED' ? 'bg-red-50 text-red-700' : 'bg-mint')}>{titleCase(pool.status)}</span>
          {live && <RefreshCw className={clsx('h-4 w-4 text-muted', isValidating && 'animate-spin')} aria-label="Live" />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="card space-y-6 p-5 sm:p-6 lg:col-span-7" aria-label="Pool details">
          <div>
            <div className="mb-1.5 flex justify-between text-xs font-bold">
              <span>Seats</span>
              <span className="tabular-nums">
                {pool.occupiedSeats} / {pool.capacity} taken · {pool.availableSeats} free
              </span>
            </div>
            <div className="flex h-3 gap-1" role="img" aria-label={`${pool.occupiedSeats} of ${pool.capacity} seats taken`}>
              {Array.from({ length: pool.capacity }, (_, i) => (
                <span key={i} className={clsx('flex-1 rounded-full', i < pool.occupiedSeats ? 'bg-dark' : 'bg-dark/10')} />
              ))}
            </div>
          </div>

          {pool.route.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                Stop order · {pool.totalDistanceKm} km{pool.score != null ? ` · route score ${pool.score.toFixed(2)}` : ''}
              </p>
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

          <div>
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Riders
            </p>
            {pool.passengers.length === 0 ? (
              <p className="rounded-2xl bg-cream p-4 text-sm text-muted">No riders yet.</p>
            ) : (
              <ul className="space-y-2">
                {pool.passengers.map((p, i) => (
                  <li key={p.rideRequestId ?? `${p.firstName}-${i}`} className={clsx('flex flex-wrap items-center gap-3 rounded-2xl border-subtle p-3.5', p.rideRequestId && !isDriver && user.role === 'PASSENGER' && 'ring-2 ring-brand')}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-mint text-sm font-black">{p.firstName.charAt(0)}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-bold">
                        {p.firstName}
                        {p.rideRequestId && user.role === 'PASSENGER' && <span className="ml-1 font-normal text-muted">(you)</span>}
                      </p>
                      <p className="text-xs text-muted">
                        stop {p.pickupSequence + 1} {p.pickupZone} → stop {p.dropoffSequence + 1} {p.dropoffZone} · {p.seats} seat{p.seats > 1 ? 's' : ''} · detour {p.detourKm} km
                      </p>
                    </div>
                    <span className="badge-tag text-[11px] font-bold">{RIDE_STATUS_LABEL[p.status as RideStatus] ?? p.status}</span>
                    {p.fare && <span className="text-sm font-black tabular-nums">{money(p.fare)}</span>}
                    {p.rideRequestId && (
                      <Link href={`/rides/${p.rideRequestId}`} className="text-xs font-bold underline-offset-2 hover:underline">
                        Ride →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted">Riders see each other’s first names and zones only; fares and ride links are visible to the rider themself, the driver and operations.</p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-dark/5 pt-5">
            {isDriver && live && <ButtonLink href="/driver">Driver dashboard</ButtonLink>}
            {mine && user.role === 'PASSENGER' && mine.rideRequestId && (
              <ButtonLink href={`/rides/${mine.rideRequestId}`}>My ride</ButtonLink>
            )}
            {canCancelPool && (
              <Button variant="danger" onClick={cancelPool} loading={busy}>
                <Ban className="h-4 w-4" aria-hidden="true" /> Close empty pool
              </Button>
            )}
          </div>
        </section>

        <div className="lg:col-span-5">
          {zones && (
            <div className="card p-4">
              <MapSwitcher zones={zones} route={pool.route.length > 1 ? pool.route : undefined} heightClass="h-80" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
