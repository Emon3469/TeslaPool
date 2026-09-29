'use client';

import 'leaflet/dist/leaflet.css';
import type { LatLngBoundsExpression, LatLngExpression, LeafletMouseEvent } from 'leaflet';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { DHAKA_BOUNDS, DHAKA_CENTER, type LatLng } from '@/lib/geo';
import type { Zone } from '@/lib/types';

export interface StreetMapProps {
  zones: Zone[];
  pickup?: string;
  dropoff?: string;
  pickupPoint?: LatLng | null;
  dropoffPoint?: LatLng | null;
  route?: string[];
  highlight?: string[];
  onMapClick?: (p: LatLng) => void;
  onZoneClick?: (code: string) => void;
  labels?: boolean;
}

const INK = '#151515';
const LIME = '#C1F11D';

function ClickHandler({ onMapClick }: { onMapClick?: (p: LatLng) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** Frames the trip when there is one, otherwise the whole service area; re-runs when either changes. */
function FitTo({ points, fallback }: { points: LatLngExpression[]; fallback: LatLngExpression[] }) {
  const map = useMap();
  const target = points.length >= 2 ? points : fallback;
  const key = JSON.stringify(target);
  useEffect(() => {
    if (target.length >= 2) map.fitBounds(target as LatLngBoundsExpression, { padding: [36, 36], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export default function StreetMapInner({ zones, pickup, dropoff, pickupPoint, dropoffPoint, route, highlight, onMapClick, onZoneClick, labels = true }: StreetMapProps) {
  const byCode = useMemo(() => new Map(zones.map((z) => [z.code, z])), [zones]);
  const routeLine = (route ?? []).map((c) => byCode.get(c)).filter(Boolean).map((z) => [z!.center.lat, z!.center.lng] as [number, number]);

  const focus: LatLngExpression[] = [];
  const pz = pickup ? byCode.get(pickup) : undefined;
  const dz = dropoff ? byCode.get(dropoff) : undefined;
  if (pickupPoint) focus.push([pickupPoint.lat, pickupPoint.lng]);
  else if (pz) focus.push([pz.center.lat, pz.center.lng]);
  if (dropoffPoint) focus.push([dropoffPoint.lat, dropoffPoint.lng]);
  else if (dz) focus.push([dz.center.lat, dz.center.lng]);
  routeLine.forEach((p) => focus.push(p));

  return (
    <MapContainer
      center={[DHAKA_CENTER.lat, DHAKA_CENTER.lng]}
      zoom={12}
      minZoom={11}
      maxBounds={[
        [DHAKA_BOUNDS.minLat, DHAKA_BOUNDS.minLng],
        [DHAKA_BOUNDS.maxLat, DHAKA_BOUNDS.maxLng],
      ]}
      scrollWheelZoom={false}
      className="h-full w-full"
      attributionControl
    >
      {/* Free OpenStreetMap tiles (attribution required); muted to the brand palette in globals.css. */}
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' maxZoom={19} />
      <ClickHandler onMapClick={onMapClick} />
      <FitTo points={focus} fallback={zones.map((z) => [z.center.lat, z.center.lng] as [number, number])} />

      {routeLine.length > 1 && <Polyline positions={routeLine} pathOptions={{ color: INK, weight: 4, dashArray: '2 10', lineCap: 'round' }} />}
      {routeLine.length < 2 && pz && dz && pickup !== dropoff && (
        <Polyline
          positions={[
            pickupPoint ? [pickupPoint.lat, pickupPoint.lng] : [pz.center.lat, pz.center.lng],
            dropoffPoint ? [dropoffPoint.lat, dropoffPoint.lng] : [dz.center.lat, dz.center.lng],
          ]}
          pathOptions={{ color: INK, weight: 3, dashArray: '8 8' }}
        />
      )}

      {zones.map((z) => {
        const isPickup = z.code === pickup;
        const isDrop = z.code === dropoff;
        const lit = isPickup || isDrop || highlight?.includes(z.code) || route?.includes(z.code);
        return (
          <CircleMarker
            key={z.code}
            center={[z.center.lat, z.center.lng]}
            radius={isPickup || isDrop ? 10 : 7}
            pathOptions={{ color: INK, weight: isPickup || isDrop ? 3 : 1.5, fillColor: isDrop ? INK : lit ? LIME : '#ffffff', fillOpacity: 1 }}
            eventHandlers={onZoneClick ? { click: (e) => { e.originalEvent.stopPropagation(); onZoneClick(z.code); } } : undefined}
          >
            {labels && (
              <Tooltip permanent direction="right" offset={[10, 0]} className="tp-zone-label">
                {z.name}
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}

      {pickupPoint && (
        <CircleMarker center={[pickupPoint.lat, pickupPoint.lng]} radius={9} pathOptions={{ color: INK, weight: 3, fillColor: LIME, fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -8]} className="tp-pin-label">
            Pickup pin
          </Tooltip>
        </CircleMarker>
      )}
      {dropoffPoint && (
        <CircleMarker center={[dropoffPoint.lat, dropoffPoint.lng]} radius={9} pathOptions={{ color: LIME, weight: 3, fillColor: INK, fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -8]} className="tp-pin-label">
            Drop-off pin
          </Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
