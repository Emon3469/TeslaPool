/** PRD §6/§14: seed data uses the story cast (Jashim, Bullet, Nusrat, Rafiq, Shirin) and is safe to re-run. */
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seed } from '../../prisma/seed';
import { createApp } from '../../src/app';
import { DEMO_PASSWORDS } from '../../src/config/env';
import { resetDb } from '../helpers/harness';

const prisma = new PrismaClient();
beforeAll(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

it('seeds the story cast, Bullet online, funded wallets, and is idempotent', async () => {
  const first = await seed(prisma);
  expect(first).toEqual({ users: 6, walletsFunded: 4, jashimOnline: true });
  expect(await seed(prisma)).toEqual({ users: 6, walletsFunded: 0, jashimOnline: false });

  const users = await prisma.user.findMany({ orderBy: { email: 'asc' }, select: { name: true, role: true, walletBalancePoysha: true } });
  expect(users.map((u) => u.name)).toEqual(['Arif Hossain', 'Jashim Uddin', 'Nusrat Jahan', 'TeslaPool Ops', 'Rafiq Islam', 'Shirin Akter']);
  expect(users.some((u) => /user\d|driver\d/i.test(u.name))).toBe(false);

  const bullet = await prisma.vehicle.findFirstOrThrow({ include: { driver: true, pools: true } });
  expect(bullet).toMatchObject({ name: 'Bullet', vehicleType: 'AUTO_RICKSHAW', capacity: 3, driver: { name: 'Jashim Uddin' } });
  expect(bullet.pools.map((p) => p.status)).toEqual(['OPEN']);
  expect(await prisma.walletTransaction.count()).toBe(4);

  // The seeded story runs immediately: Nusrat logs in and matches with Jashim's Bullet.
  const app = createApp({ prisma });
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'nusrat@teslapool.dev', password: DEMO_PASSWORDS.PASSENGER }).expect(200);
  expect(login.body.data.user.emailVerified).toBe(true);
  const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
  const ride = await request(app).post('/api/v1/rides').set(auth).send({ pickupZone: 'Banani', dropoffZone: 'Mohakhali', paymentMethod: 'TESLAPAY' }).expect(201);
  const match = await request(app).post(`/api/v1/rides/${ride.body.data.rideRequestId}/match`).set(auth).expect(200);
  expect(match.body.data).toMatchObject({ decision: 'MATCHED', match: { poolId: bullet.pools[0].id } });
});

it('gives each role its documented demo password, and re-applies it on every run', async () => {
  const app = createApp({ prisma });
  const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password });

  await prisma.user.update({ where: { email: 'jashim@teslapool.dev' }, data: { passwordHash: 'changed-elsewhere' } });
  await seed(prisma);

  expect((await login('jashim@teslapool.dev', DEMO_PASSWORDS.DRIVER)).status).toBe(200);
  expect((await login('ops@teslapool.dev', DEMO_PASSWORDS.ADMIN)).body.data.user.role).toBe('ADMIN');
  expect((await login('shirin@teslapool.dev', DEMO_PASSWORDS.PASSENGER)).status).toBe(200);
  // Roles do not share passwords.
  expect((await login('ops@teslapool.dev', DEMO_PASSWORDS.PASSENGER)).status).toBe(401);
});
