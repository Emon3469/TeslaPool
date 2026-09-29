/**
 * The race the whole design exists to win: several passengers claim the last seat
 * at the same instant. Row locks (SELECT ... FOR UPDATE) + in-transaction
 * re-validation must let exactly one through, and the database must never hold
 * occupied > capacity (also enforced by a CHECK constraint).
 */
import request from 'supertest';
import { driverWithPool, makeHarness, passengerInPool, registerUser, requestRide, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeEach(() => resetDb(h.prisma));
afterAll(() => h.close());

async function poolWithOneSeatLeft() {
  const { poolId, driver } = await driverWithPool(h.app);
  await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
  await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN');
  return { poolId, driver };
}

async function contenders(n: number) {
  return Promise.all(
    Array.from({ length: n }, async () => {
      const u = await registerUser(h.app, 'PASSENGER');
      const ride = await requestRide(h.app, u, 'BANANI', 'MOHAKHALI');
      return { u, rideId: ride.rideRequestId };
    }),
  );
}

async function assertConsistent(poolId: string) {
  const pool = await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
  const seats = await h.prisma.poolMembership.aggregate({ where: { poolId, status: 'ACTIVE' }, _sum: { seats: true } });
  expect(pool.occupiedSeats).toBeLessThanOrEqual(pool.capacity);
  expect(pool.occupiedSeats).toBe(seats._sum.seats);
  return pool;
}

it('PRD §12: Bullet has 1 seat left, Nusrat and Shirin claim it at the same instant -> exactly one succeeds, one gets CAPACITY_EXCEEDED', async () => {
  const { poolId } = await poolWithOneSeatLeft();
  const [a, b] = await Promise.all(['Nusrat Jahan', 'Shirin Akter'].map(async (name) => {
    const u = await registerUser(h.app, 'PASSENGER', name);
    const ride = await requestRide(h.app, u, 'BANANI', 'MOHAKHALI');
    return { u, rideId: ride.rideRequestId };
  }));
  const results = await Promise.all([a, b].map((c) => request(h.app).post(`/api/v1/pools/${poolId}/join`).set(c.u.auth).send({ rideRequestId: c.rideId })));

  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.status === 409)!.body.error.code).toBe('CAPACITY_EXCEEDED');
  const pool = await assertConsistent(poolId);
  expect(pool.occupiedSeats).toBe(3);
});

it('ten passengers race for the last seat: exactly one wins, occupancy never exceeds capacity', async () => {
  const { poolId } = await poolWithOneSeatLeft();
  const racers = await contenders(10);
  const results = await Promise.all(racers.map((c) => request(h.app).post(`/api/v1/pools/${poolId}/join`).set(c.u.auth).send({ rideRequestId: c.rideId })));

  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'CAPACITY_EXCEEDED')).toBe(true);
  const pool = await assertConsistent(poolId);
  expect(pool.occupiedSeats).toBe(3);
  expect(await h.prisma.rideRequest.count({ where: { status: 'MATCHED' } })).toBe(3);
});

it('concurrent auto-match: every ride ends matched at most once and no pool overflows', async () => {
  await driverWithPool(h.app);
  await driverWithPool(h.app, { who: 'KAMAL' });
  const racers = await contenders(8); // 8 riders, 2 pools x 3 seats
  const results = await Promise.all(racers.map((c) => request(h.app).post(`/api/v1/rides/${c.rideId}/match`).set(c.u.auth)));
  expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);

  const matched = results.filter((r) => r.status === 200 && r.body.data.decision === 'MATCHED');
  expect(matched.length).toBeLessThanOrEqual(6);
  for (const pool of await h.prisma.pool.findMany()) await assertConsistent(pool.id);
  const active = await h.prisma.poolMembership.groupBy({ by: ['rideRequestId'], where: { status: 'ACTIVE' }, _count: true });
  expect(active.every((g) => g._count === 1)).toBe(true);
  expect(active.length).toBe(matched.length);
});

it('the same ride cannot join two pools at once', async () => {
  const p1 = await driverWithPool(h.app);
  const p2 = await driverWithPool(h.app, { who: 'KAMAL' });
  const [c] = await contenders(1);
  const results = await Promise.all([p1.poolId, p2.poolId].map((id) => request(h.app).post(`/api/v1/pools/${id}/join`).set(c.u.auth).send({ rideRequestId: c.rideId })));
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await h.prisma.poolMembership.count({ where: { rideRequestId: c.rideId, status: 'ACTIVE' } })).toBe(1);
});

it('a join racing a cancellation of a co-rider never corrupts occupancy', async () => {
  const { poolId } = await driverWithPool(h.app);
  const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI');
  await passengerInPool(h.app, poolId, 'BANANI', 'GULSHAN');
  const racers = await contenders(3);
  await Promise.all([
    request(h.app).post(`/api/v1/rides/${n.rideId}/cancel`).set(n.user.auth).send({}),
    ...racers.map((c) => request(h.app).post(`/api/v1/pools/${poolId}/join`).set(c.u.auth).send({ rideRequestId: c.rideId })),
  ]);
  const pool = await assertConsistent(poolId);
  expect(pool.occupiedSeats).toBeLessThanOrEqual(3);
});

it('concurrent replays of one Idempotency-Key execute the mutation once', async () => {
  const { poolId } = await poolWithOneSeatLeft();
  const [c] = await contenders(1);
  const send = () => request(h.app).post(`/api/v1/pools/${poolId}/join`).set(c.u.auth).set('Idempotency-Key', 'join-once').send({ rideRequestId: c.rideId });
  const results = await Promise.all([send(), send(), send()]);
  expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
  expect(results.every((r) => r.status === 200 || (r.status === 409 && r.body.error.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS'))).toBe(true);
  expect(await h.prisma.poolMembership.count({ where: { rideRequestId: c.rideId } })).toBe(1);
});

describe('database-level guarantees (no application code involved)', () => {
  it('the DB refuses a membership that would overbook, and owns the occupancy counter', async () => {
    const { poolId } = await poolWithOneSeatLeft();
    const [c] = await contenders(1);
    const ride = await h.prisma.rideRequest.findUniqueOrThrow({ where: { id: c.rideId } });
    const base = { poolId, rideRequestId: ride.id, passengerId: ride.passengerId, pickupSequence: 0, dropoffSequence: 1, soloFarePoysha: 10000, farePoysha: 10000 };

    // Two seats into a pool with one left: rejected by the trigger, whatever the counter says.
    await expect(h.prisma.poolMembership.create({ data: { ...base, seats: 2 } })).rejects.toThrow(/TESLAPOOL_CAPACITY_GUARD/);

    // A legal raw insert: the counter follows the real memberships without any app write.
    await h.prisma.poolMembership.create({ data: { ...base, seats: 1 } });
    expect((await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } })).occupiedSeats).toBe(3);

    // Tampering with the counter is corrected on the next membership change.
    await h.prisma.pool.update({ where: { id: poolId }, data: { occupiedSeats: 0 } });
    const m = await h.prisma.poolMembership.findFirstOrThrow({ where: { rideRequestId: ride.id } });
    await h.prisma.poolMembership.update({ where: { id: m.id }, data: { status: 'CANCELLED' } });
    expect((await h.prisma.pool.findUniqueOrThrow({ where: { id: poolId } })).occupiedSeats).toBe(2);
  });
});
