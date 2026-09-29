import { formatBdt, titleCase } from '@/lib/format';
import type { Ride } from '@/lib/types';

/** The frozen standard-fare breakdown stored on a ride: base + distance + time = total. */
export function FareBreakdown({ breakdown, compact = false }: { breakdown: NonNullable<Ride['fareBreakdown']>; compact?: boolean }) {
  const rows = [
    { label: 'Base fare', value: breakdown.base.amountPoysha },
    { label: `Distance · ${breakdown.distanceKm} km`, value: breakdown.distanceCharge.amountPoysha },
    { label: `Time · ${breakdown.pricingDurationMinutes} min, ${titleCase(breakdown.trafficLevel).toLowerCase()} traffic`, value: breakdown.timeCharge.amountPoysha },
  ];
  return (
    <dl className={compact ? 'text-sm' : 'text-sm'}>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4 border-b border-dark/5 py-2">
          <dt className="text-muted">{r.label}</dt>
          <dd className="font-medium tabular-nums">{formatBdt(r.value)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 pt-2.5 font-bold">
        <dt>Standard fare</dt>
        <dd className="tabular-nums">{formatBdt(breakdown.total.amountPoysha)}</dd>
      </div>
    </dl>
  );
}
