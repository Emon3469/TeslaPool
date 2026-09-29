/**
 * The differentiators, proven through the API:
 *  1. Explainable decisions ("why matched / why this price / why not")
 *  2. Driver-side "view compatible requests -> accept" through the same transactional join
 *  3. Impact + integrity dashboard computed from real data
 *  4. HttpOnly cookie sessions with CSRF protection
 */
import request from 'supertest';
import { CONTEXT, driverWithPool, makeHarness, registerUser, requestRide, resetDb, type TestUser } from '../helpers/harness';

const h = makeHarness();
beforeEach(() => resetDb(h.prisma));
afterAll(() => h.close());

const join = (u: TestUser, poolId: string, rideRequestId: string) => request(h.app).post(`/api/v1/pools/${poolId}/join`).set(u.auth).send({ rideRequestId });

async function demoPool() {
  const { driver, poolId } = await driverWithPool(h.app);
  const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
  const rafiq = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
  const shirin = await registerUser(h.app, 'PASSENGER', 'Shirin Akter');
  const n = await requestRide(h.app, nusrat, 'BANANI', 'MOHAKHALI');
  await join(nusrat, poolId, n.rideRequestId).expect(200);
  const r = await requestRide(h.app, rafiq, 'BANANI', 'GULSHAN');
  const rJoin = await join(rafiq, poolId, r.rideRequestId).expect(200);
  const s = await requestRide(h.app, shirin, 'BANANI', 'MOHAKHALI', 2);
  const sJoin = await join(shirin, poolId, s.rideRequestId).expect(409);
  return { driver, poolId, nusrat, rafiq, shirin, nId: n.rideRequestId, rId: r.rideRequestId, sId: s.rideRequestId, rJoin, sJoin };
}

describe('1. every decision explains itself', () => {
  it('matched and rejected decisions carry a headline and a plain-language message per rule', async () => {
    const d = await demoPool();
    expect(d.rJoin.body.data.headline).toBe('Matched: Banani → Gulshan 1 → Mohakhali');
    expect(d.rJoin.body.data.checks.map((c: { message: string }) => c.message)).toEqual([
      'Pool is open for new passengers',
      '2 seats available, 1 requested',
      'Same pickup zone as current passengers',
      'Destination within 1 zone of current passengers',
      'Route has 3 stops (limit 4)',
      "Chosen route adds at most 1.1 km for any passenger (within each passenger's limit)",
    ]);
    const decision = d.sJoin.body.error.details.decision;
    expect(decision.headline).toBe('Not matched: Only 1 seat left, 2 requested');
  });

  it('GET /rides/:id/explanation answers why matched, why this price, and what happened', async () => {
    const d = await demoPool();
    const res = await request(h.app).get(`/api/v1/rides/${d.nId}/explanation`).set(d.nusrat.auth);
    expect(res.status).toBe(200);
    const x = res.body.data;

    expect(x.summary[0]).toBe('Sharing with Rafiq');
    expect(x.summary[1]).toBe('Route: Banani → Gulshan 1 → Mohakhali');
    expect(x.trip).toMatchObject({ route: ['BANANI', 'GULSHAN', 'MOHAKHALI'], yourPickup: { name: 'Banani', stopNumber: 1 }, yourDropoff: { name: 'Mohakhali', stopNumber: 3 }, yourDetourKm: 1.1 });
    expect(x.trip.coPassengers).toEqual([{ firstName: 'Rafiq', seats: 1, pickup: 'Banani', dropoff: 'Gulshan 1' }]);
    expect(JSON.stringify(x.trip)).not.toMatch(/@test\.dev|phone|rideRequestId/);
    expect(x.match).toMatchObject({ initiatedBy: 'PASSENGER', headline: 'Matched: Banani → Mohakhali' });

    // Why this price: itemised standard fare equals the quoted baseline; pooled saving is solo - pooled.
    expect(x.fare.standard.total.amountPoysha).toBe(x.fare.quote.decision.baselineFarePoysha);
    expect(x.fare.standard.base.amountPoysha + x.fare.standard.distanceCharge.amountPoysha + x.fare.standard.timeCharge.amountPoysha).toBe(x.fare.standard.total.amountPoysha);
    expect(x.fare.pooled.saving.amountPoysha).toBe(x.fare.pooled.soloFare.amountPoysha - x.fare.pooled.fare.amountPoysha);
    expect(x.fare.pooled).toMatchObject({ discountPercent: 13.89, sharedPercent: 55.6, locked: false });
    expect(x.fare.lines.at(-1)).toMatch(/^You share 55\.6% of your ride, so you get a 13\.89% pool discount: you pay ৳/);

    expect(x.timeline.map((t: { description: string }) => t.description)).toEqual([
      'Ride requested',
      'Joined a pool',
      expect.stringMatching(/^Another passenger joined; your fare ৳[\d.]+ → ৳[\d.]+; your detour 0 → 1\.1 km; route Banani → Gulshan 1 → Mohakhali$/),
    ]);
  });

  it('explains why Shirin could not join', async () => {
    const d = await demoPool();
    const x = (await request(h.app).get(`/api/v1/rides/${d.sId}/explanation`).set(d.shirin.auth)).body.data;
    expect(x.trip).toBeNull();
    expect(x.summary[0]).toBe('Not matched: Only 1 seat left, 2 requested');
    expect(x.rejections).toHaveLength(1);
    expect(x.rejections[0]).toMatchObject({ reasons: ['Only 1 seat left, 2 requested'], reasonCodes: ['CAPACITY_EXCEEDED'] });
  });

  it('is private: another passenger cannot read it, the pool driver can', async () => {
    const d = await demoPool();
    expect((await request(h.app).get(`/api/v1/rides/${d.nId}/explanation`).set(d.shirin.auth)).status).toBe(403);
    expect((await request(h.app).get(`/api/v1/rides/${d.nId}/explanation`).set(d.driver.auth)).status).toBe(200);
  });
});

describe('2. driver: view compatible requests, then accept', () => {
  it('lists waiting requests with explanations and accepts one transactionally', async () => {
    const { driver, poolId } = await driverWithPool(h.app);
    const near = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const far = await registerUser(h.app, 'PASSENGER', 'Shirin Akter');
    const nearRide = await requestRide(h.app, near, 'BANANI', 'MOHAKHALI');
    const farRide = await requestRide(h.app, far, 'DHANMONDI', 'AZIMPUR');

    const list = await request(h.app).get(`/api/v1/pools/${poolId}/requests`).set(driver.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { passengerFirstName: string; decision: { decision: string } }) => [r.passengerFirstName, r.decision.decision])).toEqual([
      ['Nusrat', 'MATCHED'],
      ['Shirin', 'MATCHED'], // empty pool: any single rider fits
    ]);

    const accepted = await request(h.app).post(`/api/v1/pools/${poolId}/accept`).set(driver.auth).send({ rideRequestId: nearRide.rideRequestId });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.decision).toBe('MATCHED');

    // Now the far request no longer fits the pool, and the list says why.
    const after = (await request(h.app).get(`/api/v1/pools/${poolId}/requests`).set(driver.auth)).body.data;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ rideRequestId: farRide.rideRequestId, decision: { decision: 'REJECTED' } });
    const rejected = await request(h.app).post(`/api/v1/pools/${poolId}/accept`).set(driver.auth).send({ rideRequestId: farRide.rideRequestId });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe('PICKUP_TOO_FAR');

    const events = await h.prisma.rideEvent.findMany({ where: { rideRequestId: nearRide.rideRequestId }, orderBy: { seq: 'asc' } });
    expect(events[1]).toMatchObject({ toStatus: 'MATCHED', actorId: driver.id, metadata: expect.objectContaining({ cause: 'DRIVER_ACCEPTED' }) });
  });

  it('only the pool’s driver can list or accept', async () => {
    const { poolId } = await driverWithPool(h.app);
    const other = await registerUser(h.app, 'DRIVER', 'Kamal Hossain');
    const p = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
    const ride = await requestRide(h.app, p, 'BANANI', 'GULSHAN');
    expect((await request(h.app).get(`/api/v1/pools/${poolId}/requests`).set(other.auth)).status).toBe(403);
    expect((await request(h.app).post(`/api/v1/pools/${poolId}/accept`).set(other.auth).send({ rideRequestId: ride.rideRequestId })).status).toBe(403);
    expect((await request(h.app).post(`/api/v1/pools/${poolId}/accept`).set(p.auth).send({ rideRequestId: ride.rideRequestId })).status).toBe(403);
    expect(await h.prisma.poolMembership.count()).toBe(0);
  });
});

describe('3. impact + integrity dashboard from real data', () => {
  it('reports what actually happened, with zero capacity violations', async () => {
    const d = await demoPool();
    for (const id of [d.nId, d.rId]) {
      await request(h.app).post(`/api/v1/rides/${id}/arrive`).set(d.driver.auth).expect(200);
      await request(h.app).post(`/api/v1/rides/${id}/start`).set(d.driver.auth).expect(200);
      await request(h.app).post(`/api/v1/rides/${id}/complete`).set(d.driver.auth).expect(200);
    }
    const res = await request(h.app).get('/api/v1/stats/impact');
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.rides).toMatchObject({ total: 3, completed: 2, active: 1, cancelled: 0 });
    expect(s.matching).toMatchObject({ ridesMatched: 2, ridesAttempted: 3, rejectedAttempts: 1 });
    expect(s.matching.matchSuccessRate).toBeCloseTo(2 / 3, 3);
    expect(s.pooling).toMatchObject({ completedPassengerTrips: 2, pooledPassengers: 2, pooledRate: 1 });
    const memberships = await h.prisma.poolMembership.findMany({ where: { status: 'COMPLETED' } });
    const savings = memberships.reduce((a, m) => a + m.soloFarePoysha - m.farePoysha, 0);
    expect(s.pooling.totalPassengerSavings.amountPoysha).toBe(savings);
    expect(s.occupancy).toMatchObject({ completedPools: 1, averagePassengersPerPool: 2, averageCapacity: 3 });
    expect(s.occupancy.seatUtilization).toBeCloseTo(2 / 3, 3);
    expect(s.integrity).toMatchObject({ capacityViolations: 0, occupancyCounterDrift: 0, checkedPools: 1 });
    expect(s.operational.matching.attempts).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(s)).not.toMatch(/@test\.dev|Nusrat|Rafiq/);
  });
});

describe('4. HttpOnly cookie sessions with CSRF protection', () => {
  const login = async () => {
    const u = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const res = await request(h.app).post('/api/v1/auth/login').send({ email: u.email, password: 'correct-horse-battery' });
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    return { u, setCookie, cookie: setCookie[0].split(';')[0] };
  };

  it('login sets an HttpOnly, SameSite session cookie that authenticates reads', async () => {
    const { setCookie, cookie, u } = await login();
    expect(setCookie[0]).toMatch(/^tp_session=/);
    expect(setCookie[0]).toMatch(/HttpOnly/);
    expect(setCookie[0]).toMatch(/SameSite=Lax/);
    expect(setCookie[0]).toMatch(/Max-Age=\d+/);
    const me = await request(h.app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(u.id);
  });

  it('rejects cookie-authenticated writes without an allowed Origin (CSRF), accepts them from the frontend origin', async () => {
    const { cookie } = await login();
    const body = { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', context: CONTEXT };
    const noOrigin = await request(h.app).post('/api/v1/rides').set('Cookie', cookie).send(body);
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
    const evil = await request(h.app).post('/api/v1/rides').set('Cookie', cookie).set('Origin', 'https://evil.example').send(body);
    expect(evil.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
    const good = await request(h.app).post('/api/v1/rides').set('Cookie', cookie).set('Origin', 'http://localhost:3000').send(body);
    expect(good.status).toBe(201);
    expect(good.headers['access-control-allow-credentials']).toBe('true');
  });

  it('logout clears the cookie', async () => {
    const res = await request(h.app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]).toMatch(/tp_session=;.*Expires=Thu, 01 Jan 1970/);
  });
});
