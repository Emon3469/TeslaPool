'use client';

import clsx from 'clsx';
import { Map as MapIcon, Network } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/States';
import type { StreetMapProps } from './StreetMapInner';
import { ZoneMap } from './ZoneMap';

/** Leaflet touches `window`, so it only ever loads in the browser. */
const StreetMapInner = dynamic(() => import('./StreetMapInner'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

export function StreetMap({ className, ...props }: StreetMapProps & { className?: string }) {
  return (
    // `isolate` keeps Leaflet's high z-index panes below the sticky site header.
    <div className={clsx('relative isolate overflow-hidden rounded-2xl border-subtle bg-mint', className ?? 'h-80')}>
      <StreetMapInner {...props} />
    </div>
  );
}

type View = 'street' | 'schematic';
const KEY = 'tp:map-view';

/**
 * Street map (OpenStreetMap tiles) or the schematic zone graph, the viewer's choice (remembered).
 * The schematic needs no network, so it is also the fallback on poor connections.
 */
export function MapSwitcher({
  zones,
  pickup,
  dropoff,
  pickupPoint,
  dropoffPoint,
  route,
  onPickZone,
  onPickPoint,
  heightClass = 'h-[340px] sm:h-[420px]',
}: {
  zones: StreetMapProps['zones'];
  pickup?: string;
  dropoff?: string;
  pickupPoint?: StreetMapProps['pickupPoint'];
  dropoffPoint?: StreetMapProps['dropoffPoint'];
  route?: string[];
  onPickZone?: (code: string) => void;
  onPickPoint?: StreetMapProps['onMapClick'];
  heightClass?: string;
}) {
  const [view, setView] = useState<View>('street');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'street' || saved === 'schematic') setView(saved);
    } catch {
      // Storage can be unavailable (private mode); the default view is fine.
    }
  }, []);

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Ignore: the choice just won't be remembered.
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Map style" className="mb-3 inline-flex rounded-full bg-chip p-1 text-xs font-bold">
        {(
          [
            ['street', 'Street map', MapIcon],
            ['schematic', 'Zone graph', Network],
          ] as const
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => choose(v)}
            className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition', view === v ? 'bg-dark text-brand' : 'text-dark/70 hover:text-dark')}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {view === 'street' ? (
        <StreetMap
          className={heightClass}
          zones={zones}
          pickup={pickup}
          dropoff={dropoff}
          pickupPoint={pickupPoint}
          dropoffPoint={dropoffPoint}
          route={route}
          onZoneClick={onPickZone}
          onMapClick={onPickPoint}
        />
      ) : (
        <ZoneMap zones={zones} pickup={pickup} dropoff={dropoff} onPick={onPickZone} route={route} className="mx-auto max-w-lg" />
      )}
    </div>
  );
}
