'use client';

import clsx from 'clsx';
import { Car, Pencil, Plus, Power } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import useSWR from 'swr';
import { AppPage } from '@/components/app/AppPage';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, errorMessage } from '@/lib/api';
import { VEHICLE_LABEL } from '@/lib/format';
import { useMeta } from '@/lib/hooks';
import type { Vehicle } from '@/lib/types';

const REG = /^[A-Z0-9][A-Z0-9 -]{1,30}[A-Z0-9]$/;

export default function VehiclesPage() {
  return (
    <AppPage title="Your vehicles" subtitle="Each vehicle’s seat count is the hard limit for its pool." roles={['DRIVER']}>
      {() => (
        <Suspense>
          <Vehicles />
        </Suspense>
      )}
    </AppPage>
  );
}

function Vehicles() {
  const toast = useToast();
  const welcome = useSearchParams().get('welcome') === '1';
  const { data: meta } = useMeta();
  const router = useRouter();
  const { data, error, mutate } = useSWR<Vehicle[]>('/vehicles');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', vehicleType: 'AUTO_RICKSHAW', registrationNumber: '', capacity: 3 });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<unknown>(null);

  const types = meta?.vehicleTypes ?? [{ code: 'AUTO_RICKSHAW', name: 'Auto-rickshaw', maxSeats: 3 }];
  const maxSeats = types.find((t) => t.code === form.vehicleType)?.maxSeats ?? 3;
  const reg = form.registrationNumber.trim().toUpperCase();
  const problems = {
    name: form.name.trim() ? undefined : 'Give your vehicle a name, e.g. Bullet.',
    reg: REG.test(reg) ? undefined : 'Letters, digits, spaces and dashes, e.g. DHAKA-METRO-TA-11-2233.',
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problems.name || problems.reg) return;
    setBusy('add');
    setFormError(null);
    try {
      await api.post<Vehicle>('/vehicles', { name: form.name.trim(), vehicleType: form.vehicleType, registrationNumber: reg, capacity: Math.min(form.capacity, maxSeats) });
      toast.success(`${form.name.trim()} registered`);
      setForm({ name: '', vehicleType: form.vehicleType, registrationNumber: '', capacity: maxSeats });
      setTouched(false);
      await mutate();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(null);
    }
  }

  async function openPool(v: Vehicle) {
    setBusy(`pool:${v.id}`);
    try {
      await api.post('/pools', { vehicleId: v.id });
      toast.success(`Pool opened with ${v.name}`, 'You are online. Riders on your route can join.');
      router.push('/driver');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACTIVE_POOL_EXISTS') {
        toast.info('You already have a live pool', 'Opening your dashboard.');
        router.push('/driver');
      } else toast.error('Could not open a pool', errorMessage(err));
      setBusy(null);
    }
  }

  async function saveEdit(v: Vehicle, name: string, capacity: number) {
    setBusy(`edit:${v.id}`);
    try {
      // Capacity is frozen while the vehicle is in a live pool, so only send it when it changed.
      await api.patch(`/vehicles/${v.id}`, { name: name.trim(), ...(capacity !== v.capacity ? { capacity } : {}) });
      toast.success('Vehicle updated');
      setEditing(null);
      await mutate();
    } catch (err) {
      toast.error('Could not update the vehicle', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(v: Vehicle) {
    setBusy(v.id);
    try {
      await api.patch(`/vehicles/${v.id}`, { isActive: !v.isActive });
      await mutate();
    } catch (err) {
      toast.error('Could not update the vehicle', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section className="space-y-3 lg:col-span-7" aria-label="Registered vehicles">
        {welcome && (
          <p role="status" className="rounded-2xl bg-brand p-4 text-sm font-medium">
            Welcome aboard! Register your first vehicle, then go online from your dashboard.
          </p>
        )}
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : !data ? (
          <LoadingBlock rows={2} />
        ) : data.length === 0 ? (
          <EmptyState title="No vehicles yet" body="Add the vehicle you drive using the form." icon={<Car className="h-6 w-6" aria-hidden="true" />} />
        ) : (
          data.map((v) =>
            editing === v.id ? (
              <EditVehicle
                key={v.id}
                vehicle={v}
                maxSeats={types.find((t) => t.code === v.vehicleType)?.maxSeats ?? 8}
                busy={busy === `edit:${v.id}`}
                onCancel={() => setEditing(null)}
                onSave={(name, capacity) => saveEdit(v, name, capacity)}
              />
            ) : (
              <article key={v.id} className={clsx('card flex flex-wrap items-center gap-4 p-5', !v.isActive && 'opacity-60')}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
                  <Car className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-black">{v.name}</p>
                  <p className="text-xs text-muted">
                    {VEHICLE_LABEL[v.vehicleType] ?? v.vehicleType} · {v.capacity} seats · <span className="font-mono">{v.registrationNumber}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {v.isActive && (
                    <Button size="sm" onClick={() => openPool(v)} loading={busy === `pool:${v.id}`} disabled={busy !== null}>
                      <Power className="h-3.5 w-3.5" aria-hidden="true" /> Open pool
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(v.id)} disabled={busy !== null} aria-label={`Edit ${v.name}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggle(v)} loading={busy === v.id} disabled={busy !== null}>
                    {v.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </article>
            ),
          )
        )}
      </section>

      <form onSubmit={add} className="card h-fit space-y-4 p-6 lg:col-span-5" noValidate>
        <h2 className="flex items-center gap-2 font-black">
          <Plus className="h-4 w-4" aria-hidden="true" /> Register a vehicle
        </h2>
        <Field label="Name" error={touched ? problems.name : undefined}>
          {(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bullet" maxLength={40} />}
        </Field>
        <Field label="Type">
          {(p) => (
            <select {...p} className="input" value={form.vehicleType} onChange={(e) => {
              const t = types.find((x) => x.code === e.target.value);
              setForm({ ...form, vehicleType: e.target.value, capacity: t?.maxSeats ?? form.capacity });
            }}>
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Registration number" error={touched ? problems.reg : undefined}>
          {(p) => <input {...p} className="input font-mono uppercase" value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} placeholder="DHAKA-METRO-TA-11-2233" maxLength={32} />}
        </Field>
        <Field label={`Seats for passengers (max ${maxSeats})`}>
          {(p) => (
            <input {...p} type="number" min={1} max={maxSeats} className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Math.max(1, Math.min(maxSeats, Number(e.target.value) || 1)) })} />
          )}
        </Field>
        {formError !== null && <ErrorState error={formError} compact />}
        <Button type="submit" className="w-full" loading={busy === 'add'}>
          Register vehicle
        </Button>
      </form>
    </div>
  );
}

function EditVehicle({ vehicle, maxSeats, busy, onCancel, onSave }: { vehicle: Vehicle; maxSeats: number; busy: boolean; onCancel: () => void; onSave: (name: string, capacity: number) => void }) {
  const [name, setName] = useState(vehicle.name);
  const [capacity, setCapacity] = useState(vehicle.capacity);
  return (
    <form
      className="card space-y-4 p-5 ring-2 ring-brand"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name, capacity);
      }}
      aria-label={`Edit ${vehicle.name}`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={name.trim() ? undefined : 'Name can’t be empty.'}>
          {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />}
        </Field>
        <Field label={`Seats (max ${maxSeats})`} hint="Can’t change while this vehicle has a live pool.">
          {(p) => <input {...p} type="number" min={1} max={maxSeats} className="input" value={capacity} onChange={(e) => setCapacity(Math.max(1, Math.min(maxSeats, Number(e.target.value) || 1)))} />}
        </Field>
      </div>
      <p className="text-xs text-muted">
        Type and registration <span className="font-mono">{vehicle.registrationNumber}</span> are fixed once registered.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={!name.trim()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
