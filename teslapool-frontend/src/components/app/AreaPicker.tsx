'use client';

import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import type { Zone } from '@/lib/types';

/**
 * The predefined list of Dhaka service areas as tappable chips, with a quick filter.
 * `tone` marks which end of the trip the chips set (lime = pickup, dark = drop-off).
 */
export function AreaPicker({
  zones,
  value,
  onChange,
  tone,
  label,
  disabledCode,
}: {
  zones: Zone[];
  value: string;
  onChange: (code: string) => void;
  tone: 'pickup' | 'dropoff';
  label: string;
  disabledCode?: string;
}) {
  const [q, setQ] = useState('');
  const id = useId();
  const shown = zones.filter((z) => z.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <fieldset>
      <div className="mb-2 flex items-center justify-between gap-3">
        <legend className="label mb-0 flex items-center gap-1.5">
          <span className={clsx('inline-block h-2.5 w-2.5 rounded-full ring-2 ring-dark', tone === 'pickup' ? 'bg-brand' : 'bg-dark')} aria-hidden="true" />
          {label}
        </legend>
        <label htmlFor={id} className="relative">
          <span className="sr-only">Filter {label.toLowerCase()} areas</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="w-28 rounded-full border border-dark/10 bg-white py-1.5 pl-8 pr-3 text-xs focus:border-dark focus:outline-none focus:ring-2 focus:ring-brand/60" />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((z) => {
          const active = z.code === value;
          return (
            <button
              key={z.code}
              type="button"
              aria-pressed={active}
              disabled={z.code === disabledCode}
              onClick={() => onChange(z.code)}
              className={clsx(
                'rounded-full px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-35',
                active ? (tone === 'pickup' ? 'bg-brand ring-2 ring-dark' : 'bg-dark text-brand') : 'bg-chip text-dark/80 hover:bg-mint',
              )}
            >
              {z.name}
            </button>
          );
        })}
        {shown.length === 0 && <span className="text-xs text-muted">No area matches “{q}”.</span>}
      </div>
    </fieldset>
  );
}
