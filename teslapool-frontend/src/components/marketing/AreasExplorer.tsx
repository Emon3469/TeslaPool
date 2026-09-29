'use client';

import clsx from 'clsx';
import { Copy, MapPin, Navigation } from 'lucide-react';
import { useState } from 'react';
import { StreetMap } from '@/components/app/StreetMap';
import { ButtonLink } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { zoneDistanceKm } from '@/lib/fare';
import { formatLatLng } from '@/lib/geo';
import type { Meta } from '@/lib/types';

/** The predefined Dhaka service areas: list, coordinates, neighbours and graph distances, on a free map. */
export function AreasExplorer({ meta }: { meta: Meta }) {
  const toast = useToast();
  const [selected, setSelected] = useState(meta.zones[0]?.code ?? '');
  const zone = meta.zones.find((z) => z.code === selected);
  const others = meta.zones
    .filter((z) => z.code !== selected)
    .map((z) => ({ z, km: zoneDistanceKm(meta, selected, z.code) }))
    .sort((a, b) => (a.km ?? 99) - (b.km ?? 99));

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Coordinates copied', text);
    } catch {
      toast.error('Could not copy', text);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <StreetMap zones={meta.zones} pickup={selected} highlight={zone?.neighbours} onZoneClick={setSelected} className="h-[360px] sm:h-[480px]" />
        <p className="mt-2 text-xs text-muted">Tap a dot to select an area. Lime dots are its neighbours on the zone graph. Map data © OpenStreetMap contributors.</p>
      </div>

      <div className="space-y-5 lg:col-span-5">
        {zone && (
          <section className="on-lime rounded-3xl bg-brand p-6" aria-live="polite" aria-labelledby="zone-h">
            <p className="text-xs font-bold uppercase tracking-wider text-dark/70">Selected area</p>
            <h2 id="zone-h" className="mt-1 text-3xl font-black">
              {zone.name}
            </h2>
            <button type="button" onClick={() => copy(`${zone.center.lat}, ${zone.center.lng}`)} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 font-mono text-xs transition hover:bg-white">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {formatLatLng(zone.center)} <Copy className="h-3 w-3" aria-hidden="true" />
            </button>
            <p className="mt-4 text-sm font-medium text-dark/75">
              Neighbours: {zone.neighbours.map((n) => meta.zones.find((z) => z.code === n)?.name ?? n).join(', ') || 'none'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ButtonLink href={`/ride/new?pickup=${zone.code}`} variant="dark">
                <Navigation className="h-4 w-4" aria-hidden="true" /> Ride from here
              </ButtonLink>
              <ButtonLink href={`/ride/new?dropoff=${zone.code}&pickup=${others[0]?.z.code ?? ''}`} variant="outline" className="border-dark/30">
                Ride here
              </ButtonLink>
            </div>
          </section>
        )}

        <section className="card p-5" aria-labelledby="dist-h">
          <h2 id="dist-h" className="mb-3 text-sm font-bold">
            Distances from {zone?.name}
          </h2>
          <ul className="space-y-2">
            {others.map(({ z, km }) => (
              <li key={z.code} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                <button type="button" onClick={() => setSelected(z.code)} className="truncate text-left font-medium hover:underline">
                  {z.name}
                </button>
                <span className="tabular-nums text-muted">{km == null ? '—' : `${km} km`}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="lg:col-span-12" aria-labelledby="all-h">
        <h2 id="all-h" className="mb-4 text-xl font-black">
          All {meta.zones.length} areas
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {meta.zones.map((z) => (
            <button
              key={z.code}
              type="button"
              onClick={() => {
                setSelected(z.code);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              aria-pressed={z.code === selected}
              className={clsx('card card-hover p-4 text-left', z.code === selected && 'ring-2 ring-dark')}
            >
              <span className="block font-black">{z.name}</span>
              <span className="mt-1 block font-mono text-[11px] text-muted">
                {z.center.lat.toFixed(4)}, {z.center.lng.toFixed(4)}
              </span>
              <span className="mt-2 block text-[11px] text-muted">{z.neighbours.length} neighbours</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
