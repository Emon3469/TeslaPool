'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Car } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { ButtonLink } from '@/components/ui/Button';
import { PhasePill } from '@/components/ui/Pills';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { apiRequest, type ResponseMeta } from '@/lib/api';
import { formatDateTime, money, zoneName } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import type { Ride } from '@/lib/types';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** Paginated `/rides` with a status filter. The API scopes it: own rides, a driver's pool rides, or all for admins. */
export function RideList({ emptyAction = true }: { emptyAction?: boolean }) {
  const { data: meta } = useMeta();
  const initial = useSearchParams().get('status') ?? '';
  const [status, setStatus] = useState(FILTERS.some((f) => f.value === initial) ? initial : '');
  const [page, setPage] = useState(1);
  const key = `/rides?page=${page}&limit=10${status ? `&status=${status}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR<{ data: Ride[]; meta: ResponseMeta }>(key, (p: string) => apiRequest<Ride[]>(p), { keepPreviousData: true });

  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Filter rides" className="no-scrollbar flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={status === f.value}
            type="button"
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
            className={clsx('whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition', status === f.value ? 'bg-brand' : 'bg-white hover:bg-mint')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock label="Loading rides" />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title={status ? 'No rides with this status' : 'No rides yet'}
          body={status ? 'Try another filter.' : 'Your trips will appear here, each with its fare breakdown and timeline.'}
          icon={<Car className="h-6 w-6" aria-hidden="true" />}
          action={emptyAction && !status ? <ButtonLink href="/ride/new">Book your first ride</ButtonLink> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {data.data.map((r) => (
            <li key={r.rideRequestId}>
              <Link href={`/rides/${r.rideRequestId}`} className="card card-hover flex flex-wrap items-center gap-4 p-4 sm:p-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    {zoneName(r.pickup.zone, meta?.zones)} → {zoneName(r.dropoff.zone, meta?.zones)}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateTime(r.createdAt)} · {r.requestedSeats} seat{r.requestedSeats > 1 ? 's' : ''} · {r.paymentMethod === 'TESLAPAY' ? 'TeslaPay' : 'Cash'}
                  </p>
                </div>
                <PhasePill phase={r.phase} status={r.status} />
                <span className="w-24 text-right text-lg font-black tabular-nums">{money(r.payment?.amount ?? r.finalFare ?? r.pool?.fare ?? r.estimatedFare)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-card disabled:opacity-40" aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold tabular-nums">
            {page} / {totalPages}
          </span>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages} className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-card disabled:opacity-40" aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
}
