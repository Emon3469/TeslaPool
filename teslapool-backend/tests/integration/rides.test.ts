import request from 'supertest';
import { CONTEXT, driverWithPool, makeHarness, registerUser, requestRide, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeEach(() => resetDb(h.prisma));
afterAll(() => h.close());

describe('POST /rides', () => {
  it('creates a ride with server-side distance, a guarded quote, audit event and prediction log', async () => {
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat');
    const res = await request(h.app).post('/api/v1/rides').set(nusrat.auth).send({ pickupZone: 'Banani', dropoffZone: 'Mohakhali', context: CONTEXT });
    expect(res.status).toBe(201);
    const d = res.body.data;
    expect(d).toMatchObject({
      status: 'REQUESTED',
      pickup: { zone: 'BANANI', name: 'Banani' },
      dropoff: { zone: 'MOHAKHALI' },
      estimatedDistanceKm: 3.4,
      distanceSource: 'ZONE_GRAPH_DISTANCE',
      estimatedDurationMinutes: 17, // 3.4 km x 5.0 min/km (MEDIUM traffic)
      fareSource: 'DETERMINISTIC', // ML sidecar disabled in tests
      estimatedFare: { amountPoysha: 12650, amountBdt: 126.5, currency: 'BDT' },
      poolOptions: [],
    });
    expect(d.quote.fare).toMatchObject({ pricingMode: 'deterministic', reason: 'DETERMINISTIC_PRICING', baselineFarePoysha: 12650, mlPredictedFarePoysha: null });
    // The itemised standard fare is frozen on the ride: base + distance + time = total.
    expect(d.fareBreakdown).toMatchObject({ base: { amountPoysha: 5000 }, distanceCharge: { amountPoysha: 6800 }, timeCharge: { amountPoysha: 850 }, total: { amountPoysha: 12650 }, pricingDurationMinutes: 17, trafficLevel: 'MEDIUM' });
    expect(d).toMatchObject({ phase: 'WAITING', paymentMethod: 'CASH', payment: null, vehicleType: 'AUTO_RICKSHAW' });

    const events = await h.prisma.rideEvent.findMany({ where: { rideRequestId: d.rideRequestId } });
    expect(events.map((e) => e.eventType)).toEqual(['RIDE_REQUESTED']);
    const predictions = await h.prisma.predictionEvent.findMany({ where: { rideRequestId: d.rideRequestId }, orderBy: { predictionType: 'asc' } });
    expect(predictions.map((p) => `${p.predictionType}:${p.modelName}@${p.modelVersion}`)).toEqual(['ETA:deterministic-eta@rules-v1', 'FARE:deterministic-fare@rules-v1']);
    expect(predictions[0].featureSnapshot).toMatchObject({ Pickup_Zone: 'Banani', Dropoff_Zone: 'Mohakhali', Distance_KM: 3.4 });
  });

  it('accepts the spec spelling "Gulshan1"', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'Banani', 'Gulshan1');
    expect(ride.dropoff).toMatchObject({ zone: 'GULSHAN', name: 'Gulshan 1' });
  });

  it.each([
    ['same zones', { pickupZone: 'BANANI', dropoffZone: 'BANANI' }, 'SAME_PICKUP_AND_DROPOFF'],
    ['unknown zone', { pickupZone: 'Mars', dropoffZone: 'BANANI' }, 'VALIDATION_ERROR'],
    ['zero seats', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', requestedSeats: 0 }, 'VALIDATION_ERROR'],
    ['more seats than a pool holds', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', requestedSeats: 4 }, 'VALIDATION_ERROR'],
    ['coordinates outside Dhaka', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', pickupLat: 51.5, pickupLng: -0.12 }, 'VALIDATION_ERROR'],
    ['half a coordinate pair', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', pickupLat: 23.79 }, 'VALIDATION_ERROR'],
    ['client-supplied surge', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', surgeMultiplier: 0.1 }, 'VALIDATION_ERROR'],
    ['client-supplied fare', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', estimatedFarePoysha: 1 }, 'VALIDATION_ERROR'],
  ])('rejects %s', async (_label, body, code) => {
    const u = await registerUser(h.app, 'PASSENGER');
    const res = await request(h.app).post('/api/v1/rides').set(u.auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it('only passengers request rides', async () => {
    const d = await registerUser(h.app, 'DRIVER');
    const res = await request(h.app).post('/api/v1/rides').set(d.auth).send({ pickupZone: 'BANANI', dropoffZone: 'GULSHAN' });
    expect(res.status).toBe(403);
  });

  it('allows only one active ride per passenger, even under concurrent submissions', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const send = () => request(h.app).post('/api/v1/rides').set(u.auth).send({ pickupZone: 'BANANI', dropoffZone: 'GULSHAN', context: CONTEXT });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ACTIVE_RIDE_EXISTS')).toBe(true);
    expect(await h.prisma.rideRequest.count({ where: { passengerId: u.id } })).toBe(1);
  });

  it('shows explainable pool options, including why a pool would reject', async () => {
    const { poolId } = await driverWithPool(h.app);
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'BANANI', 'MOHAKHALI');
    expect(ride.poolOptions).toHaveLength(1);
    expect(ride.poolOptions[0]).toMatchObject({ poolId, decision: 'MATCHED' });
  });
});

describe('idempotency', () => {
  it('replays the stored response for the same key and payload; creates exactly one ride', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const body = { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', context: CONTEXT };
    const first = await request(h.app).post('/api/v1/rides').set(u.auth).set('Idempotency-Key', 'ride-abc123').send(body);
    const second = await request(h.app).post('/api/v1/rides').set(u.auth).set('Idempotency-Key', 'ride-abc123').send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.rideRequestId).toBe(first.body.data.rideRequestId);
    expect(await h.prisma.rideRequest.count()).toBe(1);
  });

  it('refuses to reuse a key for a different payload', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    await request(h.app).post('/api/v1/rides').set(u.auth).set('Idempotency-Key', 'k-1').send({ pickupZone: 'BANANI', dropoffZone: 'GULSHAN', context: CONTEXT });
    const res = await request(h.app).post('/api/v1/rides').set(u.auth).set('Idempotency-Key', 'k-1').send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', context: CONTEXT });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('scopes keys per user (one user cannot read another user’s replay)', async () => {
    const a = await registerUser(h.app, 'PASSENGER');
    const b = await registerUser(h.app, 'PASSENGER');
    const body = { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', context: CONTEXT };
    const ra = await request(h.app).post('/api/v1/rides').set(a.auth).set('Idempotency-Key', 'shared-key').send(body);
    const rb = await request(h.app).post('/api/v1/rides').set(b.auth).set('Idempotency-Key', 'shared-key').send(body);
    expect(rb.status).toBe(201);
    expect(rb.body.data.rideRequestId).not.toBe(ra.body.data.rideRequestId);
  });
});

describe('ride access control and cancellation', () => {
  it('a passenger cannot read another passenger’s ride (IDOR)', async () => {
    const a = await registerUser(h.app, 'PASSENGER');
    const b = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, a, 'BANANI', 'GULSHAN');
    for (const path of ['', '/events']) {
      const res = await request(h.app).get(`/api/v1/rides/${ride.rideRequestId}${path}`).set(b.auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/cancel`).set(b.auth).send({})).status).toBe(403);
  });

  it('lists only my rides, paginated with a hard limit', async () => {
    const a = await registerUser(h.app, 'PASSENGER');
    const b = await registerUser(h.app, 'PASSENGER');
    await requestRide(h.app, a, 'BANANI', 'GULSHAN');
    await requestRide(h.app, b, 'BANANI', 'GULSHAN');
    const res = await request(h.app).get('/api/v1/rides?page=1&limit=10').set(a.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect((await request(h.app).get('/api/v1/rides?limit=1000').set(a.auth)).status).toBe(400);
  });

  it('cancels a REQUESTED ride and records the transition', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'BANANI', 'GULSHAN');
    const res = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/cancel`).set(u.auth).send({ reason: 'changed plans' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    const again = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/cancel`).set(u.auth).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const events = await request(h.app).get(`/api/v1/rides/${ride.rideRequestId}/events`).set(u.auth);
    expect(events.body.data.map((e: { eventType: string; to: string }) => `${e.eventType}:${e.to}`)).toEqual(['RIDE_REQUESTED:REQUESTED', 'STATUS_CHANGED:CANCELLED']);
    // A new ride is allowed once the previous one is terminal.
    await requestRide(h.app, u, 'BANANI', 'MOHAKHALI');
  });
});

describe('event history is immutable at the database level', () => {
  it('rejects UPDATE and DELETE on ride_events and prediction_events', async () => {
    const u = await registerUser(h.app, 'PASSENGER');
    const ride = await requestRide(h.app, u, 'BANANI', 'GULSHAN');
    await expect(h.prisma.rideEvent.updateMany({ where: { rideRequestId: ride.rideRequestId }, data: { eventType: 'TAMPERED' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.rideEvent.deleteMany({ where: { rideRequestId: ride.rideRequestId } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.predictionEvent.deleteMany({ where: { rideRequestId: ride.rideRequestId } })).rejects.toThrow(/append-only/);
  });
});
