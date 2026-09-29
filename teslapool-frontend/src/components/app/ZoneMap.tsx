'use client';

import clsx from 'clsx';
import { useMemo } from 'react';
import type { Zone } from '@/lib/types';

const W = 360;
const H = 300;
const PAD = 34;

/**
 * Schematic map of the service zones: each zone at its real centre (projected), lines between
 * neighbours. Click a zone to set it as the active end of the trip.
 */
export function ZoneMap({
  zones,
  pickup,
  dropoff,
  onPick,
  route,
  className,
}: {
  zones: Zone[];
  pickup?: string;
  dropoff?: string;
  onPick?: (code: string) => void;
  route?: string[];
  className?: string;
}) {
  const points = useMemo(() => {
    const lats = zones.map((z) => z.center.lat);
    const lngs = zones.map((z) => z.center.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const sx = (W - PAD * 2) / (maxLng - minLng || 1);
    const sy = (H - PAD * 2) / (maxLat - minLat || 1);
    return new Map(zones.map((z) => [z.code, { x: PAD + (z.center.lng - minLng) * sx, y: PAD + (maxLat - z.center.lat) * sy, zone: z }]));
  }, [zones]);

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: [string, string][] = [];
    for (const z of zones)
      for (const n of z.neighbours) {
        const key = [z.code, n].sort().join('|');
        if (!seen.has(key) && points.has(n)) {
          seen.add(key);
          out.push([z.code, n]);
        }
      }
    return out;
  }, [zones, points]);

  const routePath = route && route.length > 1 ? route.map((c) => points.get(c)).filter(Boolean) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={clsx('h-auto w-full select-none', className)} role="group" aria-label="Map of TeslaPool zones">
      <rect x="0" y="0" width={W} height={H} rx="24" fill="#EBF9CF" />
      {edges.map(([a, b]) => {
        const p = points.get(a)!;
        const q = points.get(b)!;
        return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#151515" strokeOpacity={0.15} strokeWidth={2} />;
      })}
      {routePath && (
        <polyline
          points={routePath.map((p) => `${p!.x},${p!.y}`).join(' ')}
          fill="none"
          stroke="#151515"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1 7"
        />
      )}
      {!routePath && pickup && dropoff && pickup !== dropoff && points.get(pickup) && points.get(dropoff) && (
        <line x1={points.get(pickup)!.x} y1={points.get(pickup)!.y} x2={points.get(dropoff)!.x} y2={points.get(dropoff)!.y} stroke="#151515" strokeWidth={3} strokeDasharray="6 6" strokeLinecap="round" />
      )}
      {[...points.values()].map(({ x, y, zone }) => {
        const isPickup = zone.code === pickup;
        const isDrop = zone.code === dropoff;
        const onRoute = route?.includes(zone.code);
        const r = isPickup || isDrop ? 11 : 7;
        const labelLeft = x > W - 90;
        return (
          <g
            key={zone.code}
            role={onPick ? 'button' : undefined}
            tabIndex={onPick ? 0 : undefined}
            aria-label={onPick ? `${zone.name}${isPickup ? ', pickup' : ''}${isDrop ? ', drop-off' : ''}` : undefined}
            aria-pressed={onPick ? isPickup || isDrop : undefined}
            onClick={onPick ? () => onPick(zone.code) : undefined}
            onKeyDown={
              onPick
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPick(zone.code);
                    }
                  }
                : undefined
            }
            className={clsx(onPick && 'cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-[#C1F11D] [&:focus-visible>circle:first-child]:stroke-[6]')}
          >
            <circle cx={x} cy={y} r={r + 8} fill="transparent" stroke="transparent" />
            <circle
              cx={x}
              cy={y}
              r={r}
              fill={isPickup ? '#C1F11D' : isDrop ? '#151515' : onRoute ? '#C1F11D' : '#fff'}
              stroke="#151515"
              strokeWidth={isPickup || isDrop ? 3 : 1.5}
              className="transition-all duration-200"
            />
            {isPickup && <circle cx={x} cy={y} r={3} fill="#151515" />}
            {isDrop && <circle cx={x} cy={y} r={3} fill="#C1F11D" />}
            <text
              x={labelLeft ? x - r - 5 : x + r + 5}
              y={y + 4}
              textAnchor={labelLeft ? 'end' : 'start'}
              fontSize="11"
              fontWeight={isPickup || isDrop ? 800 : 500}
              fill="#151515"
              className="pointer-events-none"
            >
              {zone.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
