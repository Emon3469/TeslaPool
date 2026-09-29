'use client';

import clsx from 'clsx';
import { ArrowLeftRight, Banknote, Clock, LocateFixed, MapPin, Minus, Plus, Route as RouteIcon, Wallet, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { AreaPicker } from '@/components/app/AreaPicker';
import { MapSwitcher } from '@/components/app/StreetMap';
import { Button, ButtonLink } from '@/components/ui/Button';
import { PhasePill } from '@/components/ui/Pills';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { api, ApiError, apiRequest, newIdempotencyKey } from '@/lib/api';
import { resolveContext } from '@/lib/context';
import { zoneDistanceKm } from '@/lib/fare';
import { formatBdt, titleCase, zoneName } from '@/lib/format';
import { formatLatLng, inDhaka, nearestZone, roundCoord, type LatLng } from '@/lib/geo';
import { useMeta } from '@/lib/hooks';
import { saveCreatedRide } from '@/lib/quote-cache';
import type { CreatedRide, FarePrediction, Meta, PaymentMethod, Ride, Wallet as WalletT } from '@/lib/types';

type Ctx = { traffic?: string; weather?: string; timeOfDay?: string };
type End = 'pickup' | 'dropoff';

export function BookRide() {
  return (
    <AppPage title="Request a ride" subtitle="Pick your areas from the list or the map. You’ll see the price before anything is booked." roles={['PASSENGER']} wide>
      {() => <BookRideInner />}
    </AppPage>
  );
}

function BookRideInner() {
  const { data: meta, error: metaError, mutate: reloadMeta } = useMeta();
  const active = useSWR('/rides?status=ACTIVE&limit=1', (p: string) => apiRequest<Ride[]>(p).then((r) => r.data));

  if (metaError) return <ErrorState error={metaError} onRetry={() => reloadMeta()} title="Could not load Dhaka areas" />;
  if (!meta || active.isLoading) return <LoadingBlock label="Loading areas" />;
  const activeRide = active.data?.[0];
  if (activeRide) return <ActiveRideNotice ride={activeRide} meta={meta} />;
  return <RideForm meta={meta} />;
}

function ActiveRideNotice({ ride, meta }: { ride: Ride; meta: Meta }) {
  return (
    <div className="card flex flex-col items-start justify-between gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
      <div>
        <PhasePill phase={ride.phase} status={ride.status} />
        <h2 className="mt-3 text-xl font-black">You already have a ride in progress</h2>
        <p className="mt-1 text-sm text-muted">
          {zoneName(ride.pickup.zone, meta.zones)} → {zoneName(ride.dropoff.zone, meta.zones)} · {ride.requestedSeats} seat{ride.requestedSeats > 1 ? 's' : ''}. One active
          ride at a time keeps seats honest.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ride.status === 'REQUESTED' && (
          <ButtonLink href={`/rides/${ride.rideRequestId}/matches`} variant="outline" size="lg">
            See matching pools
          </ButtonLink>
        )}
        <ButtonLink href={`/rides/${ride.rideRequestId}`} size="lg">
          Open my ride
        </ButtonLink>
      </div>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function RideForm({ meta }: { meta: Meta }) {
  const router = useRouter();
  const params = useSearchParams();
  const valid = (c: string | null) => (c && meta.zones.some((z) => z.code === c) ? c : null);
  const [pickup, setPickup] = useState(valid(params.get('pickup')) ?? 'BANANI');
  const [dropoff, setDropoff] = useState(valid(params.get('dropoff')) ?? 'MOHAKHALI');
  const [points, setPoints] = useState<Record<End, LatLng | null>>({ pickup: null, dropoff: null });
  const [focusEnd, setFocusEnd] = useState<End>('pickup');
  const [vehicleType, setVehicleType] = useState(meta.vehicleTypes[0]?.code ?? 'AUTO_RICKSHAW');
  const [seats, setSeats] = useState(1);
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [ctx, setCtx] = useState<Ctx>({});
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const idemKey = useRef<string | null>(null);
  const wallet = useSWR<WalletT>('/wallet');

  const vt = meta.vehicleTypes.find((v) => v.code === vehicleType);
  const maxSeats = Math.min(vt?.maxSeats ?? meta.rules.poolMaxCapacity, meta.rules.poolMaxCapacity);
  const sameZone = pickup === dropoff;
  const km = sameZone ? null : zoneDistanceKm(meta, pickup, dropoff);

  // Any change makes it a different request, so it needs a new idempotency key.
  const changed = () => {
    idemKey.current = null;
    setError(null);
  };
  const setZone = (end: End, code: string) => {
    changed();
    setNotice(null);
    (end === 'pickup' ? setPickup : setDropoff)(code);
    setPoints((p) => ({ ...p, [end]: null }));
  };

  function placePoint(end: End, p: LatLng) {
    if (!inDhaka(p)) {
      setNotice('That point is outside the TeslaPool service area. Pick somewhere in Dhaka.');
      return;
    }
    const near = nearestZone(p, meta.zones);
    if (!near) return;
    changed();
    const point = { lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
    (end === 'pickup' ? setPickup : setDropoff)(near.zone.code);
    setPoints((prev) => ({ ...prev, [end]: point }));
    setNotice(`${end === 'pickup' ? 'Pickup' : 'Drop-off'} pinned at ${formatLatLng(point)}, in the ${near.zone.name} zone (${near.km.toFixed(1)} km from its centre).`);
    setFocusEnd(end === 'pickup' ? 'dropoff' : 'pickup');
  }

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setNotice('Your browser can’t share its location. Pick your area from the list instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        placePoint('pickup', { lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setNotice('Location permission was not granted. Pick your area from the list instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // Live price preview: the same prediction pipeline the real request uses.
  const resolved = resolveContext(ctx);
  const previewKey = useDebounced(sameZone ? null : JSON.stringify({ vehicleType, pickupZone: pickup, dropoffZone: dropoff, ...resolved }), 350);
  const preview = useSWR<FarePrediction>(previewKey ? ['fare-preview', previewKey] : null, ([, body]: [string, string]) => api.post<FarePrediction>('/predictions/fare', JSON.parse(body)), {
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sameZone) return;
    setLoading(true);
    setError(null);
    idemKey.current ??= newIdempotencyKey('ride');
    const context = Object.fromEntries(Object.entries(ctx).filter(([, v]) => v));
    try {
      const ride = await api.post<CreatedRide>(
        '/rides',
        {
          pickupZone: pickup,
          dropoffZone: dropoff,
          requestedSeats: seats,
          vehicleType,
          paymentMethod: payment,
          ...(points.pickup ? { pickupLat: points.pickup.lat, pickupLng: points.pickup.lng } : {}),
          ...(points.dropoff ? { dropoffLat: points.dropoff.lat, dropoffLng: points.dropoff.lng } : {}),
          ...(Object.keys(context).length ? { context } : {}),
        },
        { idempotencyKey: idemKey.current },
      );
      saveCreatedRide(ride);
      router.push(`/rides/${ride.rideRequestId}/matches`);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const balance = wallet.data?.balance.amountPoysha;
  const previewFare = preview.data?.predictedFare.amountPoysha;
  const short = payment === 'TESLAPAY' && balance !== undefined && previewFare !== undefined && balance < previewFare;

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-12" noValidate>
      <div className="space-y-5 lg:col-span-7">
        <div className="card space-y-5 p-5">
          <AreaPicker zones={meta.zones} value={pickup} onChange={(c) => setZone('pickup', c)} tone="pickup" label="Pickup area" />
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-dark/10" />
            <button
              type="button"
              onClick={() => {
                changed();
                setPickup(dropoff);
                setDropoff(pickup);
                setPoints((p) => ({ pickup: p.dropoff, dropoff: p.pickup }));
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-chip transition hover:bg-brand"
              aria-label="Swap pickup and drop-off"
            >
              <ArrowLeftRight className="h-4 w-4 rotate-90" />
            </button>
            <div className="h-px flex-1 bg-dark/10" />
          </div>
          <AreaPicker zones={meta.zones} value={dropoff} onChange={(c) => setZone('dropoff', c)} tone="dropoff" label="Drop-off area" disabledCode={pickup} />
        </div>

        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1 text-xs font-bold">
            <span className="text-muted">Tap the map to pin:</span>
            {(['pickup', 'dropoff'] as const).map((end) => (
              <button
                key={end}
                type="button"
                onClick={() => setFocusEnd(end)}
                aria-pressed={focusEnd === end}
                className={clsx('rounded-full px-3 py-1.5 transition', focusEnd === end ? (end === 'pickup' ? 'bg-brand' : 'bg-dark text-brand') : 'bg-chip hover:bg-mint')}
              >
                {end === 'pickup' ? 'Pickup' : 'Drop-off'}
              </button>
            ))}
            <button type="button" onClick={useMyLocation} disabled={locating} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-dark/15 px-3 py-1.5 transition hover:bg-mint disabled:opacity-50">
              <LocateFixed className={clsx('h-3.5 w-3.5', locating && 'animate-pulse')} aria-hidden="true" /> {locating ? 'Locating…' : 'Use my location'}
            </button>
          </div>
          <MapSwitcher
            zones={meta.zones}
            pickup={pickup}
            dropoff={dropoff}
            pickupPoint={points.pickup}
            dropoffPoint={points.dropoff}
            onPickZone={(code) => {
              setZone(focusEnd, code);
              setFocusEnd(focusEnd === 'pickup' ? 'dropoff' : 'pickup');
            }}
            onPickPoint={(p) => placePoint(focusEnd, p)}
          />
          <div className="mt-3 space-y-1.5 px-1 text-xs" aria-live="polite">
            {(['pickup', 'dropoff'] as const).map((end) =>
              points[end] ? (
                <p key={end} className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  <span className="font-bold">{end === 'pickup' ? 'Pickup' : 'Drop-off'} pin:</span>
                  <span className="font-mono">{formatLatLng(points[end]!)}</span>
                  <button type="button" onClick={() => setPoints((p) => ({ ...p, [end]: null }))} className="rounded p-0.5 text-muted hover:text-dark" aria-label={`Remove ${end} pin`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </p>
              ) : null,
            )}
            {notice && <p className="text-muted">{notice}</p>}
            {!points.pickup && !points.dropoff && !notice && <p className="text-muted">Optional: drop exact pins so your driver finds you. Pricing uses the area-to-area distance either way.</p>}
          </div>
        </div>
      </div>

      <div className="space-y-5 lg:col-span-5">
        <div className="on-lime rounded-3xl bg-brand p-6" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wider text-dark/70">
            {zoneName(pickup, meta.zones)} → {zoneName(dropoff, meta.zones)}
          </p>
          {sameZone ? (
            <p className="mt-2 text-sm font-bold">Choose a drop-off in a different area.</p>
          ) : preview.error ? (
            <p className="mt-2 text-sm">Price preview unavailable. You’ll still see the exact quote on the next step.</p>
          ) : (
            <>
              <p className={clsx('mt-2 text-5xl font-black tabular-nums tracking-tight transition-opacity', preview.isValidating && 'opacity-60')}>
                {previewFare !== undefined ? formatBdt(previewFare) : '৳—'}
              </p>
              <p className="mt-1 text-sm font-medium text-dark/75">Solo price estimate for the whole ride. Pooling lowers it.</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                {preview.data && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" /> ~{Math.round(preview.data.predictedDurationMinutes)} min
                  </span>
                )}
                {km !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1">
                    <RouteIcon className="h-3.5 w-3.5" aria-hidden="true" /> {km} km
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1">
                  {titleCase(resolved.traffic).toLowerCase()} traffic · {titleCase(resolved.timeOfDay).toLowerCase()}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="card space-y-5 p-5">
          <fieldset>
            <legend className="label">Vehicle</legend>
            <div className="grid grid-cols-3 gap-2">
              {meta.vehicleTypes.map((v) => (
                <label
                  key={v.code}
                  className={clsx(
                    'cursor-pointer rounded-2xl border-2 p-2.5 text-center transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/60',
                    vehicleType === v.code ? 'border-dark bg-brand' : 'border-dark/10 hover:border-dark/30',
                  )}
                >
                  <input
                    type="radio"
                    name="vehicle"
                    className="sr-only"
                    checked={vehicleType === v.code}
                    onChange={() => {
                      changed();
                      setVehicleType(v.code);
                      setSeats((s) => Math.min(s, Math.min(v.maxSeats, meta.rules.poolMaxCapacity)));
                    }}
                  />
                  <span className="block text-xs font-bold leading-tight">{v.name}</span>
                  <span className="mt-0.5 block text-[10px] text-dark/60">up to {v.maxSeats}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center justify-between">
            <span id="seats-label" className="label mb-0">
              Seats
            </span>
            <div className="flex items-center gap-3" role="group" aria-labelledby="seats-label">
              <button type="button" onClick={() => { changed(); setSeats(Math.max(1, seats - 1)); }} disabled={seats <= 1} className="flex h-9 w-9 items-center justify-center rounded-full bg-chip transition hover:bg-brand disabled:opacity-40" aria-label="Fewer seats">
                <Minus className="h-4 w-4" />
              </button>
              <output className="w-6 text-center text-xl font-black tabular-nums" aria-live="polite">
                {seats}
              </output>
              <button type="button" onClick={() => { changed(); setSeats(Math.min(maxSeats, seats + 1)); }} disabled={seats >= maxSeats} className="flex h-9 w-9 items-center justify-center rounded-full bg-chip transition hover:bg-brand disabled:opacity-40" aria-label="More seats">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <fieldset>
            <legend className="label">Payment</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['CASH', 'Cash', 'Pay the driver', Banknote],
                  ['TESLAPAY', 'TeslaPay', balance === undefined ? 'Wallet' : `Balance ${formatBdt(balance)}`, Wallet],
                ] as const
              ).map(([value, label, sub, Icon]) => (
                <label
                  key={value}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2.5 rounded-2xl border-2 p-3 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/60',
                    payment === value ? 'border-dark bg-brand' : 'border-dark/10 hover:border-dark/30',
                  )}
                >
                  <input type="radio" name="payment" className="sr-only" checked={payment === value} onChange={() => { changed(); setPayment(value); }} />
                  <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{label}</span>
                    <span className="block truncate text-[11px] text-dark/60">{sub}</span>
                  </span>
                </label>
              ))}
            </div>
            {short && (
              <p className="mt-2 text-xs font-medium text-red-700">
                Your TeslaPay balance is below this estimate.{' '}
                <a href="/wallet" className="underline">
                  Top up
                </a>{' '}
                or pay cash.
              </p>
            )}
          </fieldset>

          <details className="group rounded-2xl bg-cream px-4 py-3">
            <summary className="cursor-pointer list-none text-xs font-bold text-dark/70 [&::-webkit-details-marker]:hidden">
              Trip conditions <span className="font-normal text-muted">(optional, defaults to now in Dhaka)</span>
            </summary>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  ['traffic', 'Traffic', meta.enums.traffic],
                  ['weather', 'Weather', meta.enums.weather],
                  ['timeOfDay', 'Time', meta.enums.timeOfDay],
                ] as const
              ).map(([key, label, options]) => (
                <div key={key}>
                  <label htmlFor={`ctx-${key}`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                    {label}
                  </label>
                  <select id={`ctx-${key}`} className="input px-2 py-2 text-xs" value={ctx[key] ?? ''} onChange={(e) => { changed(); setCtx({ ...ctx, [key]: e.target.value || undefined }); }}>
                    <option value="">Auto</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {titleCase(o)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </details>

          {error !== null && (
            <div className="space-y-2">
              <ErrorState error={error} compact />
              {error instanceof ApiError && /BALANCE|FUNDS/i.test(error.code) && (
                <ButtonLink href="/wallet" variant="outline" size="sm">
                  Top up TeslaPay
                </ButtonLink>
              )}
              {error instanceof ApiError && /ACTIVE_RIDE/i.test(error.code) && (
                <ButtonLink href="/rides?status=ACTIVE" variant="outline" size="sm">
                  See my active ride
                </ButtonLink>
              )}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={sameZone}>
            Request & find pools
          </Button>
          <p className="text-center text-[11px] text-muted">Nothing is charged now. You pay only when your trip completes.</p>
        </div>
      </div>
    </form>
  );
}
