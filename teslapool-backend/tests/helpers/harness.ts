import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { createApp, type AppDeps } from '../../src/app';

/**
 * Tests use the PRD's story cast (never user1/driver1):
 *   Jashim drives Bullet (3-seat Tesla); passengers Nusrat, Rafiq, Shirin.
 * Where a second driver is needed (competing pools, cross-driver authorization) we use one
 * consistent extra: Kamal, who drives the Tesla "Toofan".
 * Emails get a unique suffix so the same person can appear in many independent tests.
 */
export const CAST = {
  JASHIM: { name: 'Jashim Uddin', vehicle: 'Bullet' },
  KAMAL: { name: 'Kamal Hossain', vehicle: 'Toofan' },
  PASSENGERS: ['Nusrat Jahan', 'Rafiq Islam', 'Shirin Akter'],
} as const;

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;
let passengerTurn = 0;

export interface Harness {
  app: Express;
  prisma: PrismaClient;
  close(): Promise<void>;
}

export function makeHarness(overrides: Omit<AppDeps, 'prisma'> = {}): Harness {
  const prisma = new PrismaClient();
  const app = createApp({ prisma, ...overrides });
  return { app, prisma, close: () => prisma.$disconnect() };
}

/** TRUNCATE bypasses the append-only row triggers on the event/ledger tables (they fire on UPDATE/DELETE only). */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE idempotency_keys, payments, wallet_transactions, prediction_events, ride_events, pool_memberships, pools, ride_requests, vehicles, users RESTART IDENTITY CASCADE',
  );
}

export interface TestUser {
  id: string;
  token: string;
  email: string;
  name: string;
  auth: { Authorization: string };
}

export async function registerUser(app: Express, role: 'PASSENGER' | 'DRIVER', name?: string): Promise<TestUser> {
  const fullName = name ?? (role === 'DRIVER' ? CAST.JASHIM.name : CAST.PASSENGERS[passengerTurn++ % CAST.PASSENGERS.length]);
  const email = `${fullName.split(' ')[0].toLowerCase()}.${unique()}@test.dev`;
  const res = await request(app).post('/api/v1/auth/register').send({ name: fullName, email, password: 'correct-horse-battery', role });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.user.id, token: res.body.data.accessToken, email, name: fullName, auth: { Authorization: `Bearer ${res.body.data.accessToken}` } };
}

/** Jashim (default) or Kamal registers his Tesla and goes online (opens a pool). */
export async function driverWithPool(app: Express, opts: { who?: 'JASHIM' | 'KAMAL'; capacity?: number } = {}) {
  const cast = CAST[opts.who ?? 'JASHIM'];
  const driver = await registerUser(app, 'DRIVER', cast.name);
  const vehicle = await request(app)
    .post('/api/v1/vehicles')
    .set(driver.auth)
    .send({ name: cast.vehicle, vehicleType: 'AUTO_RICKSHAW', registrationNumber: `DHK-TA-${unique()}`.toUpperCase(), capacity: opts.capacity ?? 3 });
  if (vehicle.status !== 201) throw new Error(`vehicle failed: ${vehicle.status} ${JSON.stringify(vehicle.body)}`);
  const pool = await request(app).post('/api/v1/pools').set(driver.auth).send({ vehicleId: vehicle.body.data.id });
  if (pool.status !== 201) throw new Error(`pool failed: ${pool.status} ${JSON.stringify(pool.body)}`);
  return { driver, vehicleId: vehicle.body.data.id as string, poolId: pool.body.data.id as string };
}

/** Deterministic conditions so ETA/fare do not depend on the wall clock. */
export const CONTEXT = { traffic: 'MEDIUM', weather: 'CLEAR', timeOfDay: 'OFF_PEAK' } as const;

export async function requestRide(app: Express, user: TestUser, pickupZone: string, dropoffZone: string, requestedSeats = 1, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/v1/rides').set(user.auth).send({ pickupZone, dropoffZone, requestedSeats, context: CONTEXT, ...extra });
  if (res.status !== 201) throw new Error(`ride failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { rideRequestId: string; poolOptions: Array<{ poolId: string; decision: string; reasonCodes: string[] }> } & Record<string, unknown>;
}

export async function passengerInPool(app: Express, poolId: string, pickup: string, dropoff: string, seats = 1, name?: string) {
  const user = await registerUser(app, 'PASSENGER', name);
  const ride = await requestRide(app, user, pickup, dropoff, seats);
  const res = await request(app).post(`/api/v1/pools/${poolId}/join`).set(user.auth).send({ rideRequestId: ride.rideRequestId });
  if (res.status !== 200) throw new Error(`join failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user, rideId: ride.rideRequestId, decision: res.body.data };
}
