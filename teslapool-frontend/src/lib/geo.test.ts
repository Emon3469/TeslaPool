import { describe, expect, it } from 'vitest';
import { formatLatLng, haversineKm, inDhaka, nearestZone, roundCoord } from './geo';

const zone = (code: string, lat: number, lng: number) => ({ code, name: code, center: { lat, lng }, neighbours: [] });
const ZONES = [zone('BANANI', 23.7937, 90.4066), zone('GULSHAN', 23.7806, 90.4172), zone('UTTARA', 23.8759, 90.3795)];

describe('geo', () => {
  it('measures great-circle distance', () => {
    expect(haversineKm({ lat: 23.7937, lng: 90.4066 }, { lat: 23.7937, lng: 90.4066 })).toBe(0);
    const d = haversineKm(ZONES[0].center, ZONES[1].center);
    expect(d).toBeGreaterThan(1.7);
    expect(d).toBeLessThan(1.9);
  });

  it('snaps a point to the nearest zone', () => {
    expect(nearestZone({ lat: 23.79, lng: 90.41 }, ZONES)?.zone.code).toBe('BANANI');
    expect(nearestZone({ lat: 23.87, lng: 90.38 }, ZONES)?.zone.code).toBe('UTTARA');
    expect(nearestZone({ lat: 23.8, lng: 90.4 }, [])).toBeNull();
  });

  it('enforces the API bounding box', () => {
    expect(inDhaka({ lat: 23.79, lng: 90.41 })).toBe(true);
    expect(inDhaka({ lat: 22.35, lng: 91.78 })).toBe(false); // Chattogram
  });

  it('formats and rounds coordinates', () => {
    expect(formatLatLng({ lat: 23.793721, lng: 90.406612 })).toBe('23.7937° N, 90.4066° E');
    expect(roundCoord(23.7937219)).toBe(23.79372);
  });
});
