/** Login brute-force protection counts failures only, so reviewers can switch demo accounts freely. */
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { config } from '../../src/config/env';
import { resetDb } from '../helpers/harness';

const prisma = new PrismaClient();
const cfg = { ...config, rateLimit: { ...config.rateLimit, enabled: true, authMax: 3, authWindowMs: 60_000, max: 1000 } };
const app = createApp({ prisma, config: cfg });

beforeAll(async () => {
  await resetDb(prisma);
  await request(app).post('/api/v1/auth/register').send({ name: 'Nusrat Jahan', email: 'nusrat.rl@test.dev', password: 'correct-horse-battery' }).expect(201);
});
afterAll(() => prisma.$disconnect());

it('never blocks successful logins, however many', async () => {
  for (let i = 0; i < 6; i++) {
    await request(app).post('/api/v1/auth/login').send({ email: 'nusrat.rl@test.dev', password: 'correct-horse-battery' }).expect(200);
  }
});

it('blocks after too many failed logins', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await request(app).post('/api/v1/auth/login').send({ email: 'nusrat.rl@test.dev', password: 'wrong-password' })).status);
  expect(codes).toEqual([401, 401, 401, 429]);
});
