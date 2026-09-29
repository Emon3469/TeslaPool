'use client';

import { Database } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { formatTime, titleCase } from '@/lib/format';
import type { RideEvent } from '@/lib/types';

/**
 * The raw, append-only `ride_events` rows behind the friendly timeline (`GET /rides/{id}/events`).
 * Collapsed by default and fetched only when opened.
 */
export function RideEventLog({ rideId, live }: { rideId: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const { data, error, mutate } = useSWR<RideEvent[]>(open ? `/rides/${rideId}/events` : null, { refreshInterval: live ? 5000 : 0 });

  return (
    <details className="card group p-5 sm:p-6" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-black">
          <Database className="h-4 w-4" aria-hidden="true" /> Event log
          <span className="font-normal text-muted">(raw, as stored)</span>
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chip text-lg leading-none transition group-open:rotate-45 group-open:bg-brand" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="mt-4">
        {error ? (
          <ErrorState error={error} compact onRetry={() => mutate()} />
        ) : !data ? (
          <LoadingBlock rows={2} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-2 pr-3 font-bold">Time</th>
                  <th className="py-2 pr-3 font-bold">Event</th>
                  <th className="py-2 pr-3 font-bold">From → to</th>
                  <th className="py-2 font-bold">Pool</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark/5">
                {data.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 tabular-nums">{formatTime(e.createdAt)}</td>
                    <td className="py-2 pr-3 font-bold">{titleCase(e.eventType)}</td>
                    <td className="py-2 pr-3">{e.from || e.to ? `${e.from ?? '—'} → ${e.to ?? '—'}` : '—'}</td>
                    <td className="py-2 font-mono text-[10px] text-muted">{e.poolId ? e.poolId.slice(0, 8) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
