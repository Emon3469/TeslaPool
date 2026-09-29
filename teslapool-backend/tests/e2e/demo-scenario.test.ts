/**
 * The evaluator demo, end to end, through HTTP only:
 *   register -> login -> vehicle -> pool -> Nusrat (Banani→Mohakhali) -> Rafiq (Banani→Gulshan1)
 *   -> route Banani→Gulshan1→Mohakhali -> Shirin (2 seats) -> CAPACITY_EXCEEDED
 *   -> arrive -> start -> complete -> immutable event history.
 */
import request from 'supertest';
import { CONTEXT, makeHarness, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeAll(() => resetDb(h.prisma));
afterAll(() => h.close());

const api = () => request(h.app);

async function signup(name: string, role: 'PASSENGER' | 'DRIVER') {
  const email = `${name.split(' ')[0].toLowerCase()}@demo.teslapool.dev`;
  await api().post('/api/v1/auth/register').send({ name, email, password: 'demo-password-123', role }).expect(201);
  const login = await api().post('/api/v1/auth/login').send({ email, password: 'demo-password-123' }).expect(200);
  return { Authorization: `Bearer ${login.body.data.accessToken}` };
}

it('runs the full TeslaPool demo story', async () => {
  // 1-2. Register + login
  const driver = await signup('Jashim Uddin', 'DRIVER');
  const nusrat = await signup('Nusrat Jahan', 'PASSENGER');
  const rafiq = await signup('Rafiq Islam', 'PASSENGER');
  const shirin = await signup('Shirin Akter', 'PASSENGER');

  // 3. Jashim registers Bullet (3-seat Tesla) and opens a pool
  const vehicle = await api().post('/api/v1/vehicles').set(driver).send({ name: 'Bullet', vehicleType: 'AUTO_RICKSHAW', registrationNumber: 'DHAKA-METRO-TA-11-2233' }).expect(201);
  expect(vehicle.body.data.capacity).toBe(3);
  const pool = await api().post('/api/v1/pools').set(driver).send({ vehicleId: vehicle.body.data.id }).expect(201);
  const poolId = pool.body.data.id;

  // 4. Nusrat: Banani -> Mohakhali. ETA + fare predicted, pool search runs.
  const nRide = await api().post('/api/v1/rides').set(nusrat).send({ pickupZone: 'Banani', dropoffZone: 'Mohakhali', context: CONTEXT }).expect(201);
  expect(nRide.body.data).toMatchObject({ estimatedDistanceKm: 3.4, estimatedDurationMinutes: 17, estimatedFare: { amountBdt: 126.5 } });
  expect(nRide.body.data.poolOptions[0]).toMatchObject({ poolId, decision: 'MATCHED' });
  const nMatch = await api().post(`/api/v1/rides/${nRide.body.data.rideRequestId}/match`).set(nusrat).expect(200);
  expect(nMatch.body.data).toMatchObject({ decision: 'MATCHED', match: { poolId, route: ['BANANI', 'MOHAKHALI'] } });

  // 5-6. Rafiq: Banani -> Gulshan1. The engine evaluates both stop orders and picks the feasible one.
  const rRide = await api().post('/api/v1/rides').set(rafiq).send({ pickupZone: 'Banani', dropoffZone: 'Gulshan1', context: CONTEXT }).expect(201);
  const rMatch = await api().post(`/api/v1/rides/${rRide.body.data.rideRequestId}/match`).set(rafiq).expect(200);
  const decision = rMatch.body.data.match;
  expect(rMatch.body.data.decision).toBe('MATCHED');
  expect(decision).toMatchObject({
    poolId,
    route: ['BANANI', 'GULSHAN', 'MOHAKHALI'],
    detourKm: 1.1,
    capacity: { before: 1, requested: 1, after: 2 },
    reasonCodes: ['POOL_JOINABLE', 'CAPACITY_AVAILABLE', 'PICKUP_COMPATIBLE', 'DESTINATION_COMPATIBLE', 'STOP_LIMIT_SATISFIED', 'DETOUR_WITHIN_LIMIT'],
  });
  expect(decision.alternatives).toEqual(expect.arrayContaining([expect.objectContaining({ route: ['BANANI', 'MOHAKHALI', 'GULSHAN'], feasible: false, violations: ['DETOUR_TOO_HIGH'] })]));
  // Rafiq rides fully shared: 25% pool discount, integer poysha.
  expect(decision.fare).toMatchObject({ discountBps: 2500 });
  expect(Number.isInteger(decision.fare.farePoysha)).toBe(true);

  // 7-8. Shirin requests 2 seats on the same perfect route: 1 seat left -> CAPACITY_EXCEEDED.
  const sRide = await api().post('/api/v1/rides').set(shirin).send({ pickupZone: 'Banani', dropoffZone: 'Mohakhali', requestedSeats: 2, context: CONTEXT }).expect(201);
  expect(sRide.body.data.poolOptions[0]).toMatchObject({ poolId, decision: 'REJECTED', reasonCodes: ['CAPACITY_EXCEEDED'] });
  const sJoin = await api().post(`/api/v1/pools/${poolId}/join`).set(shirin).send({ rideRequestId: sRide.body.data.rideRequestId }).expect(409);
  expect(sJoin.body.error).toMatchObject({ code: 'CAPACITY_EXCEEDED', details: { requested: 2, available: 1 } });
  const routeChecks = sJoin.body.error.details.decision.checks.filter((c: { rule: string }) => c.rule !== 'CAPACITY');
  expect(routeChecks.every((c: { passed: boolean }) => c.passed)).toBe(true); // the route was fine; capacity decided

  const poolView = await api().get(`/api/v1/pools/${poolId}`).set(driver).expect(200);
  expect(poolView.body.data).toMatchObject({ status: 'MATCHED', occupiedSeats: 2, availableSeats: 1, route: ['BANANI', 'GULSHAN', 'MOHAKHALI'] });

  // 9-11. Driver lifecycle (both picked up at Banani; Rafiq dropped at Gulshan first).
  const nId = nRide.body.data.rideRequestId;
  const rId = rRide.body.data.rideRequestId;
  for (const id of [nId, rId]) await api().post(`/api/v1/rides/${id}/arrive`).set(driver).expect(200);
  for (const id of [nId, rId]) await api().post(`/api/v1/rides/${id}/start`).set(driver).expect(200);
  expect((await api().get(`/api/v1/pools/${poolId}`).set(driver)).body.data.status).toBe('STARTED');
  const rDone = await api().post(`/api/v1/rides/${rId}/complete`).set(driver).expect(200);
  const nDone = await api().post(`/api/v1/rides/${nId}/complete`).set(driver).expect(200);
  expect(rDone.body.data.finalFare.amountPoysha).toBe(rDone.body.data.pool.fare.amountPoysha);
  expect(nDone.body.data.status).toBe('COMPLETED');
  expect((await api().get(`/api/v1/pools/${poolId}`).set(driver)).body.data.status).toBe('COMPLETED');

  // 12. Immutable history tells the whole story.
  const events = await api().get(`/api/v1/rides/${nId}/events`).set(nusrat).expect(200);
  expect(events.body.data.map((e: { eventType: string; from: string | null; to: string | null }) => [e.eventType, e.from, e.to])).toEqual([
    ['RIDE_REQUESTED', null, 'REQUESTED'],
    ['STATUS_CHANGED', 'REQUESTED', 'MATCHED'],
    ['ROUTE_UPDATED', null, null], // Rafiq joined: detour 1.1 km, fare discounted
    ['STATUS_CHANGED', 'MATCHED', 'DRIVER_ARRIVED'],
    ['STATUS_CHANGED', 'DRIVER_ARRIVED', 'STARTED'],
    ['STATUS_CHANGED', 'STARTED', 'COMPLETED'],
  ]);
  const shirinEvents = await api().get(`/api/v1/rides/${sRide.body.data.rideRequestId}/events`).set(shirin).expect(200);
  expect(shirinEvents.body.data.map((e: { eventType: string }) => e.eventType)).toEqual(['RIDE_REQUESTED', 'MATCH_REJECTED']);
});
