/**
 * Dhaka zone vocabulary. `code` is the canonical API/DB value; `datasetName`
 * is the exact string used in the ML training data, so the prediction layer
 * can map features without guessing.
 */
export const ZONES = [
  'BANANI',
  'GULSHAN',
  'MOHAKHALI',
  'UTTARA',
  'MIRPUR',
  'DHANMONDI',
  'FARMGATE',
  'AZIMPUR',
  'BASHUNDHARA_RA',
  'MOTIJHEEL',
] as const;

export type Zone = (typeof ZONES)[number];

/**
 * `center` is an APPROXIMATE map anchor (median of trip coordinates per zone in the
 * training data), for placing markers in a UI. It is not used for routing or pricing.
 */
export const ZONE_INFO: Record<Zone, { displayName: string; datasetName: string; center: { lat: number; lng: number } }> = {
  BANANI: { displayName: 'Banani', datasetName: 'Banani', center: { lat: 23.794, lng: 90.4053 } },
  GULSHAN: { displayName: 'Gulshan 1', datasetName: 'Gulshan', center: { lat: 23.7905, lng: 90.4067 } },
  MOHAKHALI: { displayName: 'Mohakhali', datasetName: 'Mohakhali', center: { lat: 23.7781, lng: 90.4016 } },
  UTTARA: { displayName: 'Uttara', datasetName: 'Uttara', center: { lat: 23.875, lng: 90.3792 } },
  MIRPUR: { displayName: 'Mirpur', datasetName: 'Mirpur', center: { lat: 23.804, lng: 90.3672 } },
  DHANMONDI: { displayName: 'Dhanmondi', datasetName: 'Dhanmondi', center: { lat: 23.7456, lng: 90.3738 } },
  FARMGATE: { displayName: 'Farmgate', datasetName: 'Farmgate', center: { lat: 23.7571, lng: 90.386 } },
  AZIMPUR: { displayName: 'Azimpur', datasetName: 'Azimpur', center: { lat: 23.7288, lng: 90.385 } },
  BASHUNDHARA_RA: { displayName: 'Bashundhara R/A', datasetName: 'Bashundhara R/A', center: { lat: 23.8197, lng: 90.4251 } },
  MOTIJHEEL: { displayName: 'Motijheel', datasetName: 'Motijheel', center: { lat: 23.7349, lng: 90.4171 } },
};

/** Accepted spellings -> canonical zone. The spec says "Gulshan1", the dataset says "Gulshan". */
const ALIASES: Record<string, Zone> = {
  GULSHAN1: 'GULSHAN',
  GULSHAN_1: 'GULSHAN',
  BASHUNDHARA: 'BASHUNDHARA_RA',
  BASHUNDHARARA: 'BASHUNDHARA_RA',
};

/** Normalise user input ("Gulshan1", "gulshan-1", "Bashundhara R/A") to a canonical zone, or null. */
export function normalizeZone(input: string): Zone | null {
  const key = input.trim().toUpperCase().replace(/[\s\-/.]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if ((ZONES as readonly string[]).includes(key)) return key as Zone;
  return ALIASES[key] ?? ALIASES[key.replace(/_/g, '')] ?? null;
}
