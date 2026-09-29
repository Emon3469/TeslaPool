'use client';

import { ArrowRight, Car, PiggyBank, Plus, Repeat, Wallet as WalletIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { AreaPicker } from '@/components/app/AreaPicker';
import { RideStepper } from '@/components/app/RideStepper';
import { StreetMap } from '@/components/app/StreetMap';
import { ButtonLink } from '@/components/ui/Button';
import { PhasePill } from '@/components/ui/Pills';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States';
import { apiRequest } from '@/lib/api';
import { firstName, formatBdt, formatDateTime, money, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import { pollInterval } from '@/lib/ride';
import { riderStats } from '@/lib/stats';
import type { Meta, Ride, User, Wallet } from '@/lib/types';

export default function PassengerDashboardPage() {
  return (
    <AppPage title="Dashboard" roles={['PASSENGER']} wide>
      {(user) => <Dashboard user={user} />}
    </AppPage>
  );
}

function greeting() {
  const h = (new Date().getUTCHours() + 6) % 24;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Dashboard({ user }: { user: User }) {
  const { data: meta } = useMeta();
  const active = useSWR('/rides?status=ACTIVE&limit=1', (p: string) => apiRequest<Ride[]>(p).then((r) => r.data), {
    refreshInterval: (d) => pollInterval(d?.[0]?.phase) || 15_000,
  });
  const history = useSWR('/rides?limit=100', (p: string) => apiRequest<Ride[]>(p).then((r) => r.data));
  const wallet = useSWR<Wallet>('/wallet');

  const stats = history.data ? riderStats(history.data) : null;
  const activeRide = active.data?.[0];

  return (
    <div className="space-y-6">
      <p className="-mt-4 text-sm text-muted">
        {greeting()}, {firstName(user.name)}. Where are you headed?
      </p>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {active.error ? (
            <ErrorState error={active.error} onRetry={() => active.mutate()} />
          ) : active.isLoading ? (
            <Skeleton className="h-48 w-full rounded-3xl" />
          ) : activeRide && meta ? (
            <ActiveRideCard ride={activeRide} meta={meta} />
          ) : (
            meta && <QuickRequest meta={meta} favourites={stats?.favourites ?? []} />
          )}

          <section className="card p-5 sm:p-6" aria-labelledby="recent-h">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="recent-h" className="text-lg font-black">
                Recent rides
              </h2>
              <Link href="/rides" className="inline-flex items-center gap-1 text-sm font-bold underline-offset-2 hover:underline">
                All rides <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            {history.error ? (
              <ErrorState error={history.error} compact onRetry={() => history.mutate()} />
            ) : !history.data ? (
              <LoadingBlock rows={2} />
            ) : history.data.length === 0 ? (
              <EmptyState title="No rides yet" body="Your first pooled ride is a couple of taps away." icon={<Car className="h-6 w-6" aria-hidden="true" />} />
            ) : (
              <ul className="divide-y divide-dark/5">
                {history.data.slice(0, 4).map((r) => (
                  <li key={r.rideRequestId}>
                    <Link href={`/rides/${r.rideRequestId}`} className="flex flex-wrap items-center gap-3 rounded-xl py-3 transition hover:bg-cream/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {zoneName(r.pickup.zone, meta?.zones)} → {zoneName(r.dropoff.zone, meta?.zones)}
                        </p>
                        <p className="text-xs text-muted">{formatDateTime(r.createdAt)}</p>
                      </div>
                      <PhasePill phase={r.phase} status={r.status} />
                      <span className="w-20 text-right text-sm font-black tabular-nums">{money(r.payment?.amount ?? r.finalFare ?? r.pool?.fare ?? r.estimatedFare)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-4">
          <Link href="/wallet" className="relative block overflow-hidden rounded-3xl bg-dark p-6 text-white transition hover:-translate-y-0.5">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/60">
              <WalletIcon className="h-4 w-4" aria-hidden="true" /> TeslaPay balance
            </p>
            <p className="mt-2 text-4xl font-black tabular-nums text-brand">{wallet.data ? formatBdt(wallet.data.balance.amountPoysha) : '৳—'}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Top up
            </span>
          </Link>

          <section className="on-lime rounded-3xl bg-brand p-6" aria-labelledby="savings-h">
            <h2 id="savings-h" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-dark/70">
              <PiggyBank className="h-4 w-4" aria-hidden="true" /> Saved by pooling
            </h2>
            <p className="mt-2 text-4xl font-black tabular-nums">{stats ? formatBdt(stats.savedPoysha) : '৳—'}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                ['Trips', stats?.completed],
                ['Pooled', stats?.pooled],
                ['Spent', stats ? formatBdt(stats.spentPoysha).replace('.00', '') : undefined],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-2xl bg-white/60 px-2 py-2.5">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-dark/60">{k}</dt>
                  <dd className="truncate text-base font-black tabular-nums">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </section>

          {meta && (
            <div className="card overflow-hidden p-2">
              <StreetMap zones={meta.zones} className="h-56" labels={false} highlight={stats?.favourites.flatMap((f) => [f.pickup, f.dropoff])} />
              <p className="px-2 pb-1 pt-2 text-xs text-muted">
                {meta.zones.length} Dhaka areas served ·{' '}
                <Link href="/areas" className="font-bold text-dark underline-offset-2 hover:underline">
                  explore areas
                </Link>
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ActiveRideCard({ ride, meta }: { ride: Ride; meta: Meta }) {
  return (
    <section className="card p-5 sm:p-6" aria-labelledby="active-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Your ride now</p>
          <h2 id="active-h" className="text-xl font-black">
            {zoneName(ride.pickup.zone, meta.zones)} → {zoneName(ride.dropoff.zone, meta.zones)}
          </h2>
        </div>
        <PhasePill phase={ride.phase} status={ride.status} />
      </div>
      <RideStepper status={ride.status} />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dark/5 pt-4">
        <p className="text-sm">
          <span className="text-muted">{ride.pool ? 'Your fare' : 'Solo quote'}</span> <span className="text-xl font-black tabular-nums">{money(ride.pool?.fare ?? ride.estimatedFare)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {ride.status === 'REQUESTED' && (
            <ButtonLink href={`/rides/${ride.rideRequestId}/matches`} variant="outline">
              Pool matches
            </ButtonLink>
          )}
          {ride.pool && (
            <ButtonLink href={`/pools/${ride.pool.poolId}`} variant="outline">
              Pool view
            </ButtonLink>
          )}
          <ButtonLink href={`/rides/${ride.rideRequestId}`}>Track ride</ButtonLink>
        </div>
      </div>
    </section>
  );
}

function QuickRequest({ meta, favourites }: { meta: Meta; favourites: { pickup: string; dropoff: string; count: number }[] }) {
  const [pickup, setPickup] = useState('BANANI');
  const [dropoff, setDropoff] = useState('MOHAKHALI');
  return (
    <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="quick-h">
      <h2 id="quick-h" className="text-xl font-black">
        Request a ride
      </h2>
      <AreaPicker zones={meta.zones} value={pickup} onChange={setPickup} tone="pickup" label="From" />
      <AreaPicker zones={meta.zones} value={dropoff} onChange={setDropoff} tone="dropoff" label="To" disabledCode={pickup} />
      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink href={`/ride/new?pickup=${pickup}&dropoff=${dropoff}`} size="lg" aria-disabled={pickup === dropoff}>
          Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </ButtonLink>
        {favourites.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1 font-bold text-muted">
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" /> Again:
            </span>
            {favourites.map((f) => (
              <Link key={`${f.pickup}-${f.dropoff}`} href={`/ride/new?pickup=${f.pickup}&dropoff=${f.dropoff}`} className="badge-tag bg-mint font-bold transition hover:bg-brand">
                {zoneName(f.pickup, meta.zones)} → {zoneName(f.dropoff, meta.zones)}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
