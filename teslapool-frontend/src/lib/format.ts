import type { Money, RidePhase, RideStatus, Zone } from './types';

/** Integer poysha -> "৳1,234.50" (exact; never turns the stored amount into a float). */
export function formatBdt(poysha: number): string {
  const sign = poysha < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(poysha));
  const taka = Math.floor(abs / 100);
  const paisa = String(abs % 100).padStart(2, '0');
  return `${sign}৳${taka.toLocaleString('en-US')}.${paisa}`;
}

export const money = (m: Money | null | undefined) => (m ? formatBdt(m.amountPoysha) : '—');

/** Half-up integer division for non-negative integers (the rounding rule the API uses for fares). */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

const ZONE_FALLBACK: Record<string, string> = {
  BANANI: 'Banani',
  GULSHAN: 'Gulshan',
  MOHAKHALI: 'Mohakhali',
  UTTARA: 'Uttara',
  MIRPUR: 'Mirpur',
  DHANMONDI: 'Dhanmondi',
  FARMGATE: 'Farmgate',
  AZIMPUR: 'Azimpur',
  BASHUNDHARA_RA: 'Bashundhara R/A',
  MOTIJHEEL: 'Motijheel',
};

export function titleCase(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function zoneName(code: string, zones?: Zone[]): string {
  return zones?.find((z) => z.code === code)?.name ?? ZONE_FALLBACK[code] ?? titleCase(code);
}

export function routeLabel(route: string[], zones?: Zone[]): string {
  return route.map((z) => zoneName(z, zones)).join(' → ');
}

export const RIDE_STATUS_LABEL: Record<RideStatus, string> = {
  REQUESTED: 'Looking for a pool',
  MATCHED: 'Matched',
  DRIVER_ARRIVED: 'Driver arrived',
  STARTED: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const PHASE_LABEL: Record<RidePhase, string> = {
  WAITING: 'Waiting',
  MATCHED: 'Matched',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const VEHICLE_LABEL: Record<string, string> = {
  AUTO_RICKSHAW: 'Auto-rickshaw',
  RICKSHAW: 'Rickshaw',
  BIKE_RIDESHARE: 'Bike',
};

/** A rider's urgency: it sets only their own detour limit (see /meta rules.detourByFlexibility). */
export const FLEXIBILITY_LABEL: Record<string, { label: string; hint: string }> = {
  URGENT: { label: 'Urgent', hint: 'Almost direct. Fewer pools fit.' },
  STANDARD: { label: 'Standard', hint: 'Usual detour limit.' },
  FLEXIBLE: { label: 'Flexible', hint: 'Longer ride OK. More pools fit.' },
};

export function percent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}
