'use client';

import { Car, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { apiRequest, type ResponseMeta } from '@/lib/api';
import { formatDateTime, money, VEHICLE_LABEL, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import type { Pool } from '@/lib/types';

export default function DriverHistoryPage() {
  return (
    <AppPage title="Trip history" subtitle="Your pools, their routes and the passengers you carried." roles={['DRIVER']}>
      {() => <History />}
    </AppPage>
  );
}

function History() {
  const { data: meta } = useMeta();
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useSWR<{ data: Pool[]; meta: ResponseMeta }>(`/pools?page=${page}&limit=10`, (p: string) => apiRequest<Pool[]>(p), { keepPreviousData: true });

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <LoadingBlock />;
  if (data.data.length === 0) return <EmptyState title="No trips yet" body="Pools you drive appear here." icon={<Car className="h-6 w-6" aria-hidden="true" />} />;

  const totalPages = data.meta.totalPages ?? 1;
  return (
    <div className="space-y-4">
      {data.data.map((p) => {
        const riders = p.passengers.filter((x) => x.status !== 'CANCELLED');
        const earned = riders.reduce((s, x) => s + (x.status === 'COMPLETED' && x.fare ? x.fare.amountPoysha : 0), 0);
        return (
          <article key={p.id} className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-black">
                  {p.vehicle.name} <span className="font-normal text-muted">· {VEHICLE_LABEL[p.vehicle.vehicleType] ?? p.vehicle.vehicleType}</span>
                </p>
                <p className="text-xs text-muted">
                  {formatDateTime(p.createdAt)} · {p.route.length > 0 ? p.route.map((z) => zoneName(z, meta?.zones)).join(' → ') : 'no route'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="badge-tag text-[11px] font-bold">{p.status.toLowerCase().replace('_', ' ')}</span>
                <span className="text-lg font-black tabular-nums">{money({ amountPoysha: earned, amountBdt: earned / 100, currency: 'BDT' })}</span>
              </div>
            </div>
            {riders.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {riders.map((x, i) => (
                  <li key={i} className="rounded-full bg-cream px-3 py-1 text-xs">
                    <span className="font-bold">{x.firstName}</span> · {x.pickupZone} → {x.dropoffZone} · {money(x.fare)}
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setPage((n) => n - 1)} disabled={page <= 1} className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-card disabled:opacity-40" aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold tabular-nums">
            {page} / {totalPages}
          </span>
          <button type="button" onClick={() => setPage((n) => n + 1)} disabled={page >= totalPages} className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-card disabled:opacity-40" aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
      <p className="text-xs text-muted">Totals are the fares of completed passengers (cash and TeslaPay).</p>
    </div>
  );
}
