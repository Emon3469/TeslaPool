import request from 'supertest';
import { driverWithPool, makeHarness, passengerInPool, registerUser, requestRide, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeEach(() => resetDb(h.prisma));
afterAll(() => h.close());

const join = (auth: Record<string, string>, poolId: string, rideRequestId: string) => request(h.app).post(`/api/v1/pools/${poolId}/join`).set(auth).send({ rideRequestId });

describe('pool creation and ownership', () => {
  it('drivers open pools only with their own active vehicle, one live pool at a time', async () => {
    const { driver, vehicleId, poolId } = await driverWithPool(h.app);
    expect((await request(h.app).post('/api/v1/pools').set(driver.auth).send({ vehicleId })).body.error.code).toBe('ACTIVE_POOL_EXISTS');

    const other = await registerUser(h.app, 'DRIVER', 'Kamal Hossain');
    const res = await request(h.app).post('/api/v1/pools').set(other.auth).send({ vehicleId });
    expect(res.status).toBe(403);

    const pool = await request(h.app).get(`/api/v1/pools/${poolId}`).set(driver.auth);
    expect(pool.body.data).toMatchObject({ status: 'OPEN', capacity: 3, occupiedSeats: 0, availableSeats: 3 });
  });

  it('edge case 8: vehicle capacity beyond POOL_MAX_CAPACITY / vehicle type is rejected', async () => {
    const d = await registerUser(h.app, 'DRIVER', 'Jashim Uddin');
    const res = await request(h.app).post('/api/v1/vehicles').set(d.auth).send({ name: 'Bullet', vehicleType: 'AUTO_RICKSHAW', registrationNumber: 'CAP-TEST-1', capacity: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VEHICLE_CAPACITY_EXCEEDED');
    const bike = await request(h.app).post('/api/v1/vehicles').set(d.auth).send({ name: 'Bullet', vehicleType: 'BIKE_RIDESHARE', registrationNumber: 'CAP-TEST-2', capacity: 2 });
    expect(bike.status).toBe(422);
  });

  it('a driver cannot modify another driver’s vehicle', async () => {
    const { vehicleId } = await driverWithPool(h.app);
    const other = await registerUser(h.app, 'DRIVER', 'Kamal Hossain');
    const res = await request(h.app).patch(`/api/v1/vehicles/${vehicleId}`).set(other.auth).send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it('vehicle capacity is frozen while it serves a live pool', async () => {
    const { driver, vehicleId } = await driverWithPool(h.app);
    const res = await request(h.app).patch(`/api/v1/vehicles/${vehicleId}`).set(driver.auth).send({ capacity: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VEHICLE_UNAVAILABLE');
  });
});

describe('joining (transactional, explainable)', () => {
  it('matches, updates occupancy, re-plans the route and re-prices co-riders', async () => {
    const { poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    expect(n.decision).toMatchObject({ decision: 'MATCHED', route: ['BANANI', 'MOHAKHALI'], capacity: { before: 0, requested: 1, after: 1 } });
    const r = await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN1');
    expect(r.decision).toMatchObject({ decision: 'MATCHED', route: ['BANANI', 'GULSHAN', 'MOHAKHALI'], detourKm: 1.1, capacity: { before: 1, after: 2 } });
    expect(r.decision.fare).toMatchObject({ discountPercent: 25 });

    const pool = await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool).toMatchObject({ status: 'MATCHED', occupiedSeats: 2, plannedStops: ['BANANI', 'GULSHAN', 'MOHAKHALI'], totalDistanceKm: 4.5 });

    // Nusrat's fare dropped because she now shares 2.5 of her 4.5 km; recorded as ROUTE_UPDATED.
    const nEvents = await h.prisma.rideEvent.findMany({ where: { rideRequestId: n.rideId }, orderBy: { seq: 'asc' } });
    expect(nEvents.map((e) => e.eventType)).toEqual(['RIDE_REQUESTED', 'STATUS_CHANGED', 'ROUTE_UPDATED']);
    const membership = await h.prisma.poolMembership.findFirstOrThrow({ where: { rideRequestId: n.rideId, status: 'ACTIVE' } });
    expect(membership).toMatchObject({ discountBps: 1389, detourKm: 1.1 });
  });

  it('edge case 1: 2 seats requested with only 1 available -> CAPACITY_EXCEEDED with the full decision', async () => {
    const { poolId } = await driverWithPool(h.app);
    await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN');
    const shirin = await registerUser(h.app, 'PASSENGER', 'Shirin');
    const ride = await requestRide(h.app, shirin, 'BANANI', 'MOHAKHALI', 2);
    const res = await join(shirin.auth, poolId, ride.rideRequestId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CAPACITY_EXCEEDED', message: 'The requested number of seats is not available.', details: { requested: 2, available: 1 } });
    expect(res.body.error.details.decision.reasonCodes).toEqual(['CAPACITY_EXCEEDED']);
    expect((await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } })).occupiedSeats).toBe(2);
    // The refusal is recorded as a labelled outcome.
    expect(await h.prisma.rideEvent.count({ where: { rideRequestId: ride.rideRequestId, eventType: 'MATCH_REJECTED' } })).toBe(1);
  });

  it('edge case 6: duplicate join of the same ride -> DUPLICATE_MEMBERSHIP', async () => {
    const { poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    const res = await join(n.user.auth, poolId, n.rideId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_MEMBERSHIP');
    expect(await h.prisma.poolMembership.count({ where: { rideRequestId: n.rideId } })).toBe(1);
  });

  it('edge case 9: route reversal is rejected with PICKUP_TOO_FAR', async () => {
    const { poolId } = await driverWithPool(h.app);
    await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'MOHAKHALI', 'BANANI');
    const res = await join(u.auth, poolId, ride.rideRequestId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PICKUP_TOO_FAR');
  });

  it('edge case 10: three individually compatible passengers, collectively over the detour limit', async () => {
    const { poolId } = await driverWithPool(h.app);
    await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN');
    await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'BANANI', 'MIRPUR');
    const res = await join(u.auth, poolId, ride.rideRequestId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DETOUR_TOO_HIGH');
  });

  it('a passenger cannot join with someone else’s ride', async () => {
    const { poolId } = await driverWithPool(h.app);
    const a = await registerUser(h.app, 'PASSENGER');
    const b = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, a, 'BANANI', 'GULSHAN');
    expect((await join(b.auth, poolId, ride.rideRequestId)).status).toBe(403);
  });

  it('auto-match picks the pool with passengers over an empty vehicle', async () => {
    const first = await driverWithPool(h.app);
    await driverWithPool(h.app, { who: 'KAMAL' }); // an empty competitor
    await passengerInPool(h.app, first.poolId, 'BANANI', 'MOHAKHALI');
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'BANANI', 'GULSHAN');
    const res = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/match`).set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ decision: 'MATCHED', match: { poolId: first.poolId }, candidatesEvaluated: 2 });
  });

  it('auto-match with no feasible pool explains why instead of "no match found"', async () => {
    const { poolId } = await driverWithPool(h.app);
    await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN');
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'BANANI', 'MOHAKHALI', 2);
    const res = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/match`).set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ decision: 'REJECTED', reasonCodes: ['CAPACITY_EXCEEDED'], match: null });
    const far = await registerUser(h.app, 'PASSENGER');
    const r2 = await requestRide(h.app, far, 'DHANMONDI', 'AZIMPUR');
    const res2 = await request(h.app).post(`/api/v1/rides/${r2.rideRequestId}/match`).set(far.auth);
    expect(res2.body.data.decision).toBe('REJECTED');
    expect(res2.body.data.reasonCodes).toEqual(expect.arrayContaining(['PICKUP_TOO_FAR', 'DESTINATION_TOO_FAR']));
  });
});

describe('lifecycle, authorization and state rules', () => {
  it('edge case 3: a driver cannot drive another driver’s pool', async () => {
    const { poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    const intruder = await registerUser(h.app, 'DRIVER', 'Kamal Hossain');
    const res = await request(h.app).post(`/api/v1/rides/${n.rideId}/arrive`).set(intruder.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await request(h.app).get(`/api/v1/pools/${poolId}`).set(intruder.auth)).status).toBe(403);
  });

  it('edge case 5: invalid transition (start before arrival) -> INVALID_STATE_TRANSITION', async () => {
    const { driver, poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    const res = await request(h.app).post(`/api/v1/rides/${n.rideId}/start`).set(driver.auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'MATCHED', to: 'STARTED' } });
  });

  it('edge cases 2 and 7: no joining a STARTED pool, no cancelling a STARTED ride', async () => {
    const { driver, poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    await request(h.app).post(`/api/v1/rides/${n.rideId}/arrive`).set(driver.auth).expect(200);
    await request(h.app).post(`/api/v1/rides/${n.rideId}/start`).set(driver.auth).expect(200);
    expect((await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } })).status).toBe('STARTED');

    const late = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, late, 'BANANI', 'GULSHAN');
    const res = await join(late.auth, poolId, ride.rideRequestId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POOL_ALREADY_STARTED');

    const cancel = await request(h.app).post(`/api/v1/rides/${n.rideId}/cancel`).set(n.user.auth).send({});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('late join after DRIVER_ARRIVED is rejected by default', async () => {
    const { driver, poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    await request(h.app).post(`/api/v1/rides/${n.rideId}/arrive`).set(driver.auth).expect(200);
    const late = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, late, 'BANANI', 'GULSHAN');
    expect((await join(late.auth, poolId, ride.rideRequestId)).body.error.code).toBe('LATE_JOIN_NOT_ALLOWED');
  });

  it('leaving returns the ride to REQUESTED, frees the seat and re-prices the co-rider', async () => {
    const { poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    const r = await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN');
    const res = await request(h.app).post(`/api/v1/pools/${poolId}/leave`).set(r.user.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REQUESTED');
    const pool = await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool).toMatchObject({ occupiedSeats: 1, plannedStops: ['BANANI', 'MOHAKHALI'], status: 'MATCHED' });
    const nm = await h.prisma.poolMembership.findFirstOrThrow({ where: { rideRequestId: n.rideId, status: 'ACTIVE' } });
    expect(nm).toMatchObject({ detourKm: 0, discountBps: 0, farePoysha: nm.soloFarePoysha });
    // ...and can be matched again (a new membership row; the old one is kept as LEFT).
    await request(h.app).post(`/api/v1/pools/${poolId}/join`).set(r.user.auth).send({ rideRequestId: r.rideId }).expect(200);
    expect(await h.prisma.poolMembership.count({ where: { rideRequestId: r.rideId } })).toBe(2);
  });

  it('cancelling a matched ride frees the seat; the last passenger leaving re-opens the pool', async () => {
    const { poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    await request(h.app).post(`/api/v1/rides/${n.rideId}/cancel`).set(n.user.auth).send({}).expect(200);
    const pool = await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool).toMatchObject({ occupiedSeats: 0, status: 'OPEN', plannedStops: [] });
  });

  it('drivers cancel only empty OPEN pools', async () => {
    const { driver, poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    expect((await request(h.app).post(`/api/v1/pools/${poolId}/cancel`).set(driver.auth)).body.error.code).toBe('POOL_NOT_EMPTY');
    await request(h.app).post(`/api/v1/rides/${n.rideId}/cancel`).set(n.user.auth).send({}).expect(200);
    const res = await request(h.app).post(`/api/v1/pools/${poolId}/cancel`).set(driver.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('co-riders see first names only and never each other’s fares', async () => {
    const { poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
    await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN');
    const view = await request(h.app).get(`/api/v1/pools/${poolId}`).set(n.user.auth);
    expect(view.status).toBe(200);
    const others = view.body.data.passengers.filter((p: { rideRequestId: string | null }) => p.rideRequestId !== n.rideId);
    expect(others).toHaveLength(1);
    expect(others[0]).toMatchObject({ rideRequestId: null, fare: null });
    expect(JSON.stringify(view.body)).not.toMatch(/@test\.dev|phone/);
  });
});
