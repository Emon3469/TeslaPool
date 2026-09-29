'use client';

import clsx from 'clsx';
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet as WalletIcon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { formatBdt, formatDateTime } from '@/lib/format';
import type { User, Wallet } from '@/lib/types';

const PRESETS = [20000, 50000, 100000];
const TX_LABEL = { TOP_UP: 'Top-up', RIDE_PAYMENT: 'Ride payment', RIDE_EARNING: 'Ride earning' } as const;

export default function WalletPage() {
  return (
    <AppPage title="TeslaPay" subtitle="Your wallet. Every entry is a permanent ledger record; the balance can never go below zero.">
      {(user) => <WalletInner user={user} />}
    </AppPage>
  );
}

function WalletInner({ user }: { user: User }) {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR<Wallet>('/wallet');
  const [amount, setAmount] = useState('500');
  const [busy, setBusy] = useState(false);
  const [topUpError, setTopUpError] = useState<unknown>(null);
  // One key per intended top-up: a retry after a timeout replays instead of crediting twice.
  const key = useRef<string | null>(null);

  const poysha = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(poysha) && poysha >= 100 && poysha <= 1_000_000;

  async function topUp(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setTopUpError(null);
    key.current ??= newIdempotencyKey('topup');
    try {
      const w = await api.post<Wallet>('/wallet/top-up', { amountPoysha: poysha }, { idempotencyKey: key.current });
      key.current = null;
      await mutate(w, { revalidate: false });
      toast.success('Wallet topped up', `New balance ${formatBdt(w.balance.amountPoysha)}`);
    } catch (err) {
      setTopUpError(err);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (isLoading || !data) return <LoadingBlock label="Loading wallet" />;

  const isDriver = user.role === 'DRIVER';

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-5">
        <div className="relative overflow-hidden rounded-4xl bg-dark p-7 text-white">
          <svg className="absolute -right-10 -top-10 h-48 w-48 text-brand/20" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="8" />
            <circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" strokeWidth="8" />
          </svg>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/60">
            <WalletIcon className="h-4 w-4" aria-hidden="true" /> {isDriver ? 'Earnings balance' : 'Available balance'}
          </p>
          <p className="mt-3 text-5xl font-black tabular-nums tracking-tight text-brand">{formatBdt(data.balance.amountPoysha)}</p>
          <p className="mt-2 text-sm text-white/60">{user.name}</p>
        </div>

        {!isDriver && (
          <form onSubmit={topUp} className="card space-y-4 p-6" noValidate>
            <h2 className="font-black">Add money</h2>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    key.current = null;
                    setAmount(String(p / 100));
                  }}
                  className={clsx('rounded-full px-4 py-2 text-sm font-bold transition', poysha === p ? 'bg-brand' : 'bg-chip hover:bg-mint')}
                >
                  {formatBdt(p)}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="amount" className="label">
                Amount (৳)
              </label>
              <input
                id="amount"
                inputMode="decimal"
                className="input text-lg font-bold"
                value={amount}
                onChange={(e) => {
                  key.current = null;
                  setAmount(e.target.value.replace(/[^\d.]/g, ''));
                }}
                aria-invalid={!valid}
                aria-describedby="amount-hint"
              />
              <p id="amount-hint" className={clsx('mt-1.5 text-xs', valid ? 'text-muted' : 'text-red-700')}>
                Between ৳1 and ৳10,000. Top-ups are simulated: no real money moves.
              </p>
            </div>
            {topUpError !== null && <ErrorState error={topUpError} compact />}
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!valid}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add {valid ? formatBdt(poysha) : ''}
            </Button>
          </form>
        )}
        {isDriver && (
          <div className="card p-6 text-sm text-muted">
            TeslaPay fares are credited here the moment you complete each passenger’s trip. Cash fares are paid to you directly and don’t appear in this wallet.
          </div>
        )}
      </div>

      <section className="card p-5 sm:p-6 lg:col-span-7" aria-labelledby="ledger-h">
        <h2 id="ledger-h" className="mb-4 text-lg font-black">
          Ledger
        </h2>
        {data.transactions.length === 0 ? (
          <EmptyState title="No transactions yet" body={isDriver ? 'Complete a TeslaPay ride to see earnings here.' : 'Top up to pay for rides with TeslaPay.'} />
        ) : (
          <ul className="divide-y divide-dark/5">
            {data.transactions.map((t) => {
              const credit = t.amount.amountPoysha > 0;
              return (
                <li key={t.id} className="flex items-center gap-4 py-3.5">
                  <span className={clsx('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl', credit ? 'bg-brand' : 'bg-chip')}>
                    {credit ? <ArrowDownLeft className="h-4 w-4" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{TX_LABEL[t.type]}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(t.createdAt)}
                      {t.rideRequestId && (
                        <>
                          {' · '}
                          <Link href={`/rides/${t.rideRequestId}`} className="underline-offset-2 hover:underline">
                            view ride
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={clsx('font-black tabular-nums', credit ? 'text-dark' : 'text-dark/80')}>
                      {credit ? '+' : ''}
                      {formatBdt(t.amount.amountPoysha)}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted">bal {formatBdt(t.balanceAfter.amountPoysha)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
