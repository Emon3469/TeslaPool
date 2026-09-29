/** What a Next.js frontend relies on: reference data, "current" lookups, CORS preflight and a complete OpenAPI contract. */
import request from 'supertest';
import { openApiDocument } from '../../src/docs/openapi';
import { driverWithPool, makeHarness, passengerInPool, registerUser, requestRide, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeEach(() => resetDb(h.prisma));
afterAll(() => h.close());

it('GET /meta returns zones, enums, rules and fare units without authentication', async () => {
  const res = await request(h.app).get('/api/v1/meta');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('max-age');
  const d = res.body.data;
  expect(d.zones).toHaveLength(10);
  expect(d.zones.find((z: { code: string }) => z.code === 'GULSHAN')).toMatchObject({ name: 'Gulshan 1', center: { lat: expect.any(Number) }, neighbours: expect.arrayContaining(['BANANI', 'MOHAKHALI']) });
  expect(d.distanceKm.BANANI.MOHAKHALI).toBe(3.4);
  expect(d.vehicleTypes).toEqual([
    { code: 'AUTO_RICKSHAW', name: 'Auto-rickshaw ("Tesla", 3 seats)', maxSeats: 3 },
    { code: 'RICKSHAW', name: 'Rickshaw', maxSeats: 2 },
    { code: 'BIKE_RIDESHARE', name: 'Bike (ride-share)', maxSeats: 1 },
  ]);
  expect(d.rideTransitions.REQUESTED).toEqual(['MATCHED', 'CANCELLED']);
  expect(d.rules).toMatchObject({ poolMaxCapacity: 3, maxStops: 4, maxDetourKm: 1.5 });
  expect(d.fare).toMatchObject({ currency: 'BDT', minorUnit: 'poysha', minorUnitsPerBdt: 100 });
});

it('GET /rides?status=ACTIVE finds the passenger’s current ride', async () => {
  const u = await registerUser(h.app, 'PASSENGER');
  const first = await requestRide(h.app, u, 'BANANI', 'GULSHAN');
  await request(h.app).post(`/api/v1/rides/${first.rideRequestId}/cancel`).set(u.auth).send({}).expect(200);
  const current = await requestRide(h.app, u, 'BANANI', 'MOHAKHALI');

  const active = await request(h.app).get('/api/v1/rides?status=ACTIVE').set(u.auth);
  expect(active.body.data.map((r: { rideRequestId: string }) => r.rideRequestId)).toEqual([current.rideRequestId]);
  const cancelled = await request(h.app).get('/api/v1/rides?status=CANCELLED').set(u.auth);
  expect(cancelled.body.data).toHaveLength(1);
  expect((await request(h.app).get('/api/v1/rides?status=NOPE').set(u.auth)).status).toBe(400);
});

it('GET /pools?status=ACTIVE finds the driver’s live pool (and a passenger’s pool) after a reload', async () => {
  const { driver, poolId } = await driverWithPool(h.app);
  const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI', 1, 'Nusrat Jahan');
  const other = await driverWithPool(h.app, { who: 'KAMAL' });

  const mine = await request(h.app).get('/api/v1/pools?status=ACTIVE').set(driver.auth);
  expect(mine.status).toBe(200);
  expect(mine.body.data.map((p: { id: string }) => p.id)).toEqual([poolId]);
  expect(mine.body.data[0].passengers[0]).toMatchObject({ rideRequestId: n.rideId, firstName: 'Nusrat' });
  expect(mine.body.meta).toMatchObject({ total: 1 });

  const asPassenger = await request(h.app).get('/api/v1/pools?status=ACTIVE').set(n.user.auth);
  expect(asPassenger.body.data.map((p: { id: string }) => p.id)).toEqual([poolId]);
  expect(asPassenger.body.data.some((p: { id: string }) => p.id === other.poolId)).toBe(false);
});

it('answers a browser CORS preflight from the frontend origin', async () => {
  const res = await request(h.app)
    .options('/api/v1/rides')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
  expect(res.status).toBe(204);
  expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
  expect(res.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/i);
  expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-ID/i);
});

it('serves an OpenAPI document that covers every public route', async () => {
  const res = await request(h.app).get('/api/docs/openapi.json');
  expect(res.status).toBe(200);
  const paths = Object.keys(res.body.paths);
  for (const p of [
    '/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/users/me', '/api/v1/vehicles', '/api/v1/vehicles/{id}',
    '/api/v1/rides', '/api/v1/rides/{id}', '/api/v1/rides/{id}/events', '/api/v1/rides/{id}/match', '/api/v1/rides/{id}/cancel',
    '/api/v1/rides/{id}/arrive', '/api/v1/rides/{id}/start', '/api/v1/rides/{id}/complete',
    '/api/v1/pools', '/api/v1/pools/{id}', '/api/v1/pools/{id}/join', '/api/v1/pools/{id}/leave', '/api/v1/pools/{id}/cancel',
    '/api/v1/predictions/eta', '/api/v1/predictions/fare', '/api/v1/meta', '/health', '/health/ready',
    '/api/v1/rides/{id}/explanation', '/api/v1/pools/{id}/requests', '/api/v1/pools/{id}/accept', '/api/v1/stats/impact', '/api/v1/auth/logout',
  ]) {
    expect(paths).toContain(p);
  }
  expect(res.body.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  expect(res.body.components.schemas).toHaveProperty('MatchDecision');
  expect(openApiDocument().openapi).toBe('3.0.3');
});

it('serves the Swagger UI', async () => {
  const res = await request(h.app).get('/api/docs/');
  expect(res.status).toBe(200);
  expect(res.text).toContain('swagger-ui');
});
