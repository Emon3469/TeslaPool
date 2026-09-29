'use client';

import clsx from 'clsx';
import Link from 'next/link';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { ImpactDashboard } from '@/components/marketing/ImpactDashboard';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { apiRequest } from '@/lib/api';
import { money, RIDE_STATUS_LABEL, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import type { Pool, RideStatus } from '@/lib/types';

export default function OpsPage() {
  return (
    <AppPage title="Ops console" subtitle="Live pools and platform health, refreshed automatically." roles={['ADMIN']} wide>
      {() => <Ops />}
    </AppPage>
  );
}

function Ops() {
  const { data: meta } = useMeta();
  const pools = useSWR('/pools?status=ACTIVE&limit=50', (p: string) => apiRequest<Pool[]>(p).then((r) => r.data), { refreshInterval: 5000 });

  return (
    <div className="space-y-10">
      <section aria-labelledby="live-h">
        <h2 id="live-h" className="mb-4 text-xl font-black">
          Live pools {pools.data && <span className="text-muted">({pools.data.length})</span>}
        </h2>
        {pools.error ? (
          <ErrorState error={pools.error} onRetry={() => pools.mutate()} />
        ) : !pools.data ? (
          <LoadingBlock rows={2} />
        ) : pools.data.length === 0 ? (
          <EmptyState title="No live pools" body="Pools appear here when drivers go online." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pools.data.map((p) => (
              <article key={p.id} className="card p-5">
                <div className="flex items-center justify-between">
                  <Link href={`/pools/${p.id}`} className="font-black underline-offset-2 hover:underline">
                    {p.vehicle.name}
                  </Link>
                  <span className="badge-tag text-[11px] font-bold">{p.status.toLowerCase().replace('_', ' ')}</span>
                </div>
                <div className="mt-3 flex h-2.5 gap-1" role="img" aria-label={`${p.occupiedSeats} of ${p.capacity} seats taken`}>
                  {Array.from({ length: p.capacity }, (_, i) => (
                    <span key={i} className={clsx('flex-1 rounded-full', i < p.occupiedSeats ? 'bg-dark' : 'bg-dark/10')} />
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">{p.route.length ? p.route.map((z) => zoneName(z, meta?.zones)).join(' → ') : 'Waiting for riders'}</p>
                <ul className="mt-3 space-y-1 text-xs">
                  {p.passengers.map((x, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        <span className="font-bold">{x.firstName}</span> · {RIDE_STATUS_LABEL[x.status as RideStatus] ?? x.status}
                      </span>
                      <span className="tabular-nums">{money(x.fare)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="health-h">
        <h2 id="health-h" className="mb-4 text-xl font-black">
          Platform health
        </h2>
        <ImpactDashboard initial={null} />
      </section>
    </div>
  );
}
