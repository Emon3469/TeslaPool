'use client';

import clsx from 'clsx';
import { Activity, Brain, Database, Server } from 'lucide-react';
import useSWR from 'swr';
import type { Health, Readiness } from '@/lib/types';

/** Health endpoints are plain JSON (no envelope) and may answer 503 with a body, so read them directly. */
async function getJson<T>(url: string): Promise<{ status: number; body: T | null }> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return { status: res.status, body: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { status: 0, body: null };
  }
}

function formatUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
}

const tone = (s: string | undefined) =>
  s === 'up' || s === 'ok' || s === 'ready' ? 'bg-brand text-dark' : s === 'disabled' || s === 'ready_degraded' || s === 'degraded' ? 'bg-[#F5EC47] text-dark' : 'bg-red-100 text-red-700';

function Tile({ icon: Icon, title, status, children }: { icon: typeof Server; title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          {title}
        </span>
        <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider', tone(status))}>{status.replace('_', ' ')}</span>
      </div>
      <div className="mt-4 text-sm text-dark/80">{children}</div>
    </div>
  );
}

export function SystemHealth() {
  const live = useSWR('sys:health', () => getJson<Health>('/api/sys/health'), { refreshInterval: 10_000 });
  const ready = useSWR('sys:ready', () => getJson<Readiness>('/api/sys/ready'), { refreshInterval: 10_000 });

  const h = live.data?.body;
  const r = ready.data?.body;
  const apiStatus = live.data ? (h?.status ?? 'down') : 'checking';
  const db = r?.checks?.database;
  const ml = r?.checks?.ml;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={clsx('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold', tone(r?.status ?? (ready.data ? 'down' : 'checking')))}>
          <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Overall: {r?.status?.replace('_', ' ') ?? (ready.data ? 'unreachable' : 'checking…')}
        </span>
        <span className="text-xs text-muted">Checks every 10 s · readiness HTTP {ready.data?.status || '—'}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Tile icon={Server} title="API" status={apiStatus}>
          {h ? (
            <dl className="space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted">Version</dt>
                <dd className="font-mono">{h.version}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Uptime</dt>
                <dd className="tabular-nums">{formatUptime(h.uptimeSeconds)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted">{live.data ? 'The API is not responding.' : 'Checking…'}</p>
          )}
        </Tile>
        <Tile icon={Database} title="PostgreSQL" status={db?.status ?? (ready.data ? 'unknown' : 'checking')}>
          {db?.latencyMs != null ? (
            <p>
              Round-trip <span className="font-black tabular-nums">{db.latencyMs} ms</span>
            </p>
          ) : (
            <p className="text-muted">No reading.</p>
          )}
        </Tile>
        <Tile icon={Brain} title="ML sidecar" status={ml?.status ?? (ready.data ? 'unknown' : 'checking')}>
          <p className="text-muted">{typeof ml?.fallback === 'string' ? ml.fallback : ml?.latencyMs != null ? `Responding in ${ml.latencyMs} ms` : 'ETA and fare models (optional).'}</p>
        </Tile>
      </div>
    </div>
  );
}
