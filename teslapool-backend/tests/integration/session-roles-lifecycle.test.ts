import request from 'supertest';
import { driverWithPool, makeHarness, registerUser, requestRide, resetDb, CONTEXT } from '../helpers/harness';

const h = makeHarness();
beforeAll(() => resetDb(h.prisma));
afterAll(() => h.close());

const status = async (rideId: string, auth: { Authorization: string }) => (await request(h.app).get(`/api/v1/rides/${rideId}`).set(auth)).body.data.status as string;

describe('one browser, several tabs: a tab never acts as another account', () => {
  // All tabs share one cookie. Nusrat's tab says "I am Nusrat" (X-Session-User), but the cookie now holds
  // Jashim's session because he signed in from another tab.
  it('refuses a passenger tab’s ride request when the session now belongs to a driver, and creates nothing', async () => {
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const { driver: jashim } = await driverWithPool(h.app);

    const res = await request(h.app)
      .post('/api/v1/rides')
      .set(jashim.auth)
      .set('X-Session-User', nusrat.id)
      .send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', requestedSeats: 1, context: CONTEXT });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_ACCOUNT_CHANGED');
    expect(await h.prisma.rideRequest.count({ where: { passengerId: { in: [nusrat.id, jashim.id] } } })).toBe(0);
  });

  it('refuses reads too, so a passenger tab never shows driver data', async () => {
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const { driver: jashim } = await driverWithPool(h.app, { who: 'KAMAL' });
    const res = await request(h.app).get('/api/v1/driver/status').set(jashim.auth).set('X-Session-User', nusrat.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_ACCOUNT_CHANGED');
  });

  it('works normally when the tab and the session agree, or when no tab header is sent (scripts, mobile)', async () => {
    const rafiq = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
    const me = await request(h.app).get('/api/v1/auth/me').set(rafiq.auth).set('X-Session-User', rafiq.id);
    expect(me.status).toBe(200);
    const plain = await request(h.app).get('/api/v1/wallet').set(rafiq.auth);
    expect(plain.status).toBe(200);
  });
});

describe('full ride lifecycle with role checks at every step', () => {
  it('REQUESTED → MATCHED (driver accepts) → DRIVER_ARRIVED → STARTED → COMPLETED; only the pool’s driver can move it', async () => {
    const { driver: jashim, poolId } = await driverWithPool(h.app);
    const { driver: kamal } = await driverWithPool(h.app, { who: 'KAMAL' });
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const shirin = await registerUser(h.app, 'PASSENGER', 'Shirin Akter');

    // A driver can't request rides.
    const driverRide = await request(h.app).post('/api/v1/rides').set(jashim.auth).send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', requestedSeats: 1, context: CONTEXT });
    expect(driverRide.status).toBe(403);

    const ride = await requestRide(h.app, nusrat, 'BANANI', 'MOHAKHALI');
    expect(await status(ride.rideRequestId, nusrat.auth)).toBe('REQUESTED');

    // Passengers can't accept, another driver can't accept into Jashim's pool, the pool's driver can.
    expect((await request(h.app).post(`/api/v1/pools/${poolId}/accept`).set(nusrat.auth).send({ rideRequestId: ride.rideRequestId })).status).toBe(403);
    expect((await request(h.app).post(`/api/v1/pools/${poolId}/accept`).set(kamal.auth).send({ rideRequestId: ride.rideRequestId })).status).toBe(403);
    const accepted = await request(h.app).post(`/api/v1/pools/${poolId}/accept`).set(jashim.auth).send({ rideRequestId: ride.rideRequestId });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.decision).toBe('MATCHED');
    expect(await status(ride.rideRequestId, nusrat.auth)).toBe('MATCHED');

    // Nobody else can read the ride.
    expect((await request(h.app).get(`/api/v1/rides/${ride.rideRequestId}`).set(shirin.auth)).status).toBe(403);

    // Steps can't be skipped: start before arrive is an invalid transition.
    const early = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/start`).set(jashim.auth);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');

    for (const [action, next] of [['arrive', 'DRIVER_ARRIVED'], ['start', 'STARTED'], ['complete', 'COMPLETED']] as const) {
      // Only the pool's driver moves the ride: not the passenger, not another driver.
      expect((await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/${action}`).set(nusrat.auth)).status).toBe(403);
      expect((await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/${action}`).set(kamal.auth)).status).toBe(403);
      const res = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/${action}`).set(jashim.auth);
      expect(res.status).toBe(200);
      expect(await status(ride.rideRequestId, nusrat.auth)).toBe(next);
      if (action === 'start') {
        // Once the trip has started it can't be cancelled.
        const cancel = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/cancel`).set(nusrat.auth).send({});
        expect(cancel.status).toBe(409);
      }
    }

    // Completed is terminal.
    expect((await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/cancel`).set(nusrat.auth).send({})).status).toBe(409);
    expect((await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/complete`).set(jashim.auth)).status).toBe(409);
  });

  it.each([
    ['REQUESTED', 0],
    ['MATCHED', 1],
    ['DRIVER_ARRIVED', 2],
  ] as const)('a passenger can cancel from %s, and only their own ride', async (_from, steps) => {
    const { driver, poolId } = await driverWithPool(h.app);
    const rider = await registerUser(h.app, 'PASSENGER', 'Arif Hossain');
    const other = await registerUser(h.app, 'PASSENGER', 'Shirin Akter');
    const ride = await requestRide(h.app, rider, 'BANANI', 'MOHAKHALI');
    if (steps >= 1) expect((await request(h.app).post(`/api/v1/pools/${poolId}/join`).set(rider.auth).send({ rideRequestId: ride.rideRequestId })).status).toBe(200);
    if (steps >= 2) expect((await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/arrive`).set(driver.auth)).status).toBe(200);

    expect((await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/cancel`).set(other.auth).send({})).status).toBe(403);
    const res = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/cancel`).set(rider.auth).send({});
    expect(res.status).toBe(200);
    expect(await status(ride.rideRequestId, rider.auth)).toBe('CANCELLED');
    // The seat is free again.
    const pool = await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool.occupiedSeats).toBe(0);
  });
});
