import request from 'supertest';
import { CONTEXT, driverWithPool, makeHarness, registerUser, requestRide, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeAll(() => resetDb(h.prisma));
afterAll(() => h.close());

const join = (auth: { Authorization: string }, poolId: string, rideRequestId: string) => request(h.app).post(`/api/v1/pools/${poolId}/join`).set(auth).send({ rideRequestId });

describe('urgency over HTTP: Nusrat is late for Mohakhali', () => {
  it('urgent Nusrat + flexible Rafiq share Bullet via Banani → Mohakhali → Gulshan 1; a standard rider is not squeezed in', async () => {
    const { driver: jashim, poolId } = await driverWithPool(h.app);
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const rafiq = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
    const shirin = await registerUser(h.app, 'PASSENGER', 'Shirin Akter');

    const n = await requestRide(h.app, nusrat, 'BANANI', 'MOHAKHALI', 1, { flexibility: 'URGENT' });
    expect((await request(h.app).get(`/api/v1/rides/${n.rideRequestId}`).set(nusrat.auth)).body.data.flexibility).toBe('URGENT');
    expect((await join(nusrat.auth, poolId, n.rideRequestId)).status).toBe(200);

    // Shirin keeps the default (STANDARD): no order satisfies both her limit and Nusrat's.
    const s = await requestRide(h.app, shirin, 'BANANI', 'GULSHAN', 1, { context: CONTEXT });
    const refused = await join(shirin.auth, poolId, s.rideRequestId);
    expect(refused.body.data?.decision ?? refused.body.error?.code).not.toBe('MATCHED');

    // Rafiq accepts a longer ride: the route now goes to Mohakhali first.
    const r = await requestRide(h.app, rafiq, 'BANANI', 'GULSHAN', 1, { flexibility: 'FLEXIBLE' });
    const joined = await join(rafiq.auth, poolId, r.rideRequestId);
    expect(joined.status).toBe(200);
    expect(joined.body.data.route).toEqual(['BANANI', 'MOHAKHALI', 'GULSHAN']);

    const pool = (await request(h.app).get(`/api/v1/pools/${poolId}`).set(jashim.auth)).body.data;
    expect(pool.route).toEqual(['BANANI', 'MOHAKHALI', 'GULSHAN']);
    const byName = Object.fromEntries(pool.passengers.map((p: { firstName: string }) => [p.firstName, p]));
    expect(byName.Nusrat).toMatchObject({ flexibility: 'URGENT', detourKm: 0, pickupSequence: 0, dropoffSequence: 1 });
    expect(byName.Rafiq).toMatchObject({ flexibility: 'FLEXIBLE', detourKm: 2.9 });
  });

  it('rejects unknown flexibility values', async () => {
    const u = await registerUser(h.app, 'PASSENGER', 'Arif Hossain');
    const res = await request(h.app).post('/api/v1/rides').set(u.auth).send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', flexibility: 'VIP', context: CONTEXT });
    expect(res.status).toBe(400);
  });

  it('the driver sees urgent riders first among those who fit', async () => {
    const { driver, poolId } = await driverWithPool(h.app, { who: 'KAMAL' });
    const early = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
    const late = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    await requestRide(h.app, early, 'BANANI', 'MOHAKHALI');
    await requestRide(h.app, late, 'BANANI', 'MOHAKHALI', 1, { flexibility: 'URGENT' });
    const list = (await request(h.app).get(`/api/v1/pools/${poolId}/requests`).set(driver.auth)).body.data as Array<{ passengerFirstName: string; flexibility: string; decision: { decision: string } }>;
    const fits = list.filter((x) => x.decision.decision === 'MATCHED');
    expect(fits[0]).toMatchObject({ passengerFirstName: 'Nusrat', flexibility: 'URGENT' });
  });
});
