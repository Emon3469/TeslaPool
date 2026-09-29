/** Payments (cash / simulated TeslaPay), driver online/offline, passenger tracking phases. */
import request from 'supertest';
import { CAST, CONTEXT, driverWithPool, makeHarness, passengerInPool, registerUser, requestRide, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeEach(() => resetDb(h.prisma));
afterAll(() => h.close());

describe('TeslaPay wallet (simulated, database-owned balance)', () => {
  it('top-ups are ledgered, idempotent with a key, and bounded', async () => {
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const topUp = () => request(h.app).post('/api/v1/wallet/top-up').set(nusrat.auth).set('Idempotency-Key', 'topup-nusrat-1').send({ amountPoysha: 20_000 });
    const [a, b] = [await topUp(), await topUp()];
    expect(a.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    const wallet = (await request(h.app).get('/api/v1/wallet').set(nusrat.auth)).body.data;
    expect(wallet.balance.amountPoysha).toBe(20_000);
    expect(wallet.transactions).toHaveLength(1);
    expect(wallet.transactions[0]).toMatchObject({ type: 'TOP_UP', amount: { amountPoysha: 20_000 }, balanceAfter: { amountPoysha: 20_000 } });

    for (const amountPoysha of [0, 99, 1_000_001, 12.5, -500]) {
      expect((await request(h.app).post('/api/v1/wallet/top-up').set(nusrat.auth).send({ amountPoysha })).status).toBe(400);
    }
  });

  it('a TeslaPay ride needs a balance that covers the quoted solo fare', async () => {
    const shirin = await registerUser(h.app, 'PASSENGER', 'Shirin Akter');
    const res = await request(h.app).post('/api/v1/rides').set(shirin.auth).send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', paymentMethod: 'TESLAPAY', context: CONTEXT });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_WALLET_BALANCE', details: { requiredPoysha: 12650, balancePoysha: 0 } });
    await request(h.app).post('/api/v1/wallet/top-up').set(shirin.auth).send({ amountPoysha: 12650 }).expect(201);
    await request(h.app).post('/api/v1/rides').set(shirin.auth).send({ pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', paymentMethod: 'TESLAPAY', context: CONTEXT }).expect(201);
  });

  it('the database refuses overdrafts and rewriting the ledger, whatever the application does', async () => {
    const rafiq = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
    await request(h.app).post('/api/v1/wallet/top-up').set(rafiq.auth).send({ amountPoysha: 1000 }).expect(201);
    const ride = await requestRide(h.app, rafiq, 'BANANI', 'GULSHAN');
    await expect(h.prisma.walletTransaction.create({ data: { userId: rafiq.id, rideRequestId: ride.rideRequestId, type: 'RIDE_PAYMENT', amountPoysha: -1001 } })).rejects.toThrow(/TESLAPOOL_INSUFFICIENT_FUNDS/);
    await expect(h.prisma.walletTransaction.create({ data: { userId: rafiq.id, type: 'TOP_UP', amountPoysha: -5 } })).rejects.toThrow(/wallet_transactions_sign_chk/);
    await expect(h.prisma.walletTransaction.updateMany({ where: { userId: rafiq.id }, data: { amountPoysha: 999_999 } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.user.update({ where: { id: rafiq.id }, data: { walletBalancePoysha: -1 } })).rejects.toThrow(/users_wallet_non_negative_chk/);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: rafiq.id } })).walletBalancePoysha).toBe(1000);
  });

  it('settles each completed ride exactly once, in the completion transaction', async () => {
    const { driver: jashim, poolId } = await driverWithPool(h.app);
    const rafiq = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
    await request(h.app).post('/api/v1/wallet/top-up').set(rafiq.auth).send({ amountPoysha: 20_000 }).expect(201);
    const ride = await requestRide(h.app, rafiq, 'BANANI', 'GULSHAN', 1, { paymentMethod: 'TESLAPAY' });
    await request(h.app).post(`/api/v1/pools/${poolId}/join`).set(rafiq.auth).send({ rideRequestId: ride.rideRequestId }).expect(200);
    for (const step of ['arrive', 'start', 'complete']) await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/${step}`).set(jashim.auth).expect(200);
    // Solo in the pool: no discount, 10625 poysha.
    const again = await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/complete`).set(jashim.auth);
    expect(again.status).toBe(409);
    expect(await h.prisma.payment.count({ where: { rideRequestId: ride.rideRequestId } })).toBe(1);
    expect(await h.prisma.walletTransaction.count({ where: { rideRequestId: ride.rideRequestId } })).toBe(2);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: rafiq.id } })).walletBalancePoysha).toBe(20_000 - 10_625);
    await expect(h.prisma.payment.deleteMany({})).rejects.toThrow(/append-only/);

    const x = (await request(h.app).get(`/api/v1/rides/${ride.rideRequestId}/explanation`).set(rafiq.auth)).body.data;
    expect(x.fare.lines.at(-1)).toBe('Paid ৳106.25 from your TeslaPay wallet.');
  });

  it('a cancelled ride is never charged', async () => {
    const { poolId } = await driverWithPool(h.app);
    const n = await passengerInPool(h.app, poolId, 'BANANI', 'MOHAKHALI', 1, 'Nusrat Jahan');
    await request(h.app).post(`/api/v1/rides/${n.rideId}/cancel`).set(n.user.auth).send({}).expect(200);
    expect(await h.prisma.payment.count()).toBe(0);
  });
});

describe('driver: go online / offline (PRD §3)', () => {
  async function jashimWithBullet() {
    const jashim = await registerUser(h.app, 'DRIVER', CAST.JASHIM.name);
    const bullet = await request(h.app).post('/api/v1/vehicles').set(jashim.auth).send({ name: 'Bullet', registrationNumber: 'DHAKA-METRO-TA-11-2233' }).expect(201);
    expect(bullet.body.data).toMatchObject({ name: 'Bullet', vehicleType: 'AUTO_RICKSHAW', capacity: 3 });
    return { jashim, bulletId: bullet.body.data.id as string };
  }

  it('online opens a pool with the chosen Tesla, is idempotent, and offline cancels it while empty', async () => {
    const { jashim, bulletId } = await jashimWithBullet();
    expect((await request(h.app).get('/api/v1/driver/status').set(jashim.auth)).body.data).toMatchObject({ online: false, pool: null, vehicles: [{ name: 'Bullet' }] });

    const on = await request(h.app).post('/api/v1/driver/online').set(jashim.auth).send({ vehicleId: bulletId });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ online: true, pool: { status: 'OPEN', vehicle: { name: 'Bullet', capacity: 3 }, availableSeats: 3 } });
    const again = await request(h.app).post('/api/v1/driver/online').set(jashim.auth).send({ vehicleId: bulletId });
    expect(again.body.data.pool.id).toBe(on.body.data.pool.id);

    const off = await request(h.app).post('/api/v1/driver/offline').set(jashim.auth);
    expect(off.body.data).toMatchObject({ online: false, pool: null });
  });

  it('cannot go offline while passengers are assigned', async () => {
    const { jashim, bulletId } = await jashimWithBullet();
    const on = (await request(h.app).post('/api/v1/driver/online').set(jashim.auth).send({ vehicleId: bulletId })).body.data;
    await passengerInPool(h.app, on.pool.id, 'BANANI', 'MOHAKHALI', 1, 'Nusrat Jahan');
    const off = await request(h.app).post('/api/v1/driver/offline').set(jashim.auth);
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('DRIVER_HAS_PASSENGERS');
    expect((await request(h.app).get('/api/v1/driver/status').set(jashim.auth)).body.data.pool.passengers[0]).toMatchObject({ firstName: 'Nusrat', seats: 1 });
  });

  it('only with your own vehicle, and one vehicle at a time; passengers cannot go online', async () => {
    const { jashim, bulletId } = await jashimWithBullet();
    const kamal = await registerUser(h.app, 'DRIVER', CAST.KAMAL.name);
    expect((await request(h.app).post('/api/v1/driver/online').set(kamal.auth).send({ vehicleId: bulletId })).status).toBe(403);
    const toofan = await request(h.app).post('/api/v1/vehicles').set(jashim.auth).send({ name: 'Toofan', registrationNumber: 'DHAKA-METRO-TA-11-9999' }).expect(201);
    await request(h.app).post('/api/v1/driver/online').set(jashim.auth).send({ vehicleId: bulletId }).expect(200);
    const second = await request(h.app).post('/api/v1/driver/online').set(jashim.auth).send({ vehicleId: toofan.body.data.id });
    expect(second.status).toBe(409);
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    expect((await request(h.app).post('/api/v1/driver/online').set(nusrat.auth).send({ vehicleId: bulletId })).status).toBe(403);
  });

  it('concurrent "go online" calls leave exactly one live pool', async () => {
    const { jashim, bulletId } = await jashimWithBullet();
    const results = await Promise.all([1, 2, 3].map(() => request(h.app).post('/api/v1/driver/online').set(jashim.auth).send({ vehicleId: bulletId })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await h.prisma.pool.count({ where: { driverId: jashim.id, status: 'OPEN' } })).toBe(1);
  });
});

describe('passenger tracking phases (PRD: waiting → matched → in progress → completed/cancelled)', () => {
  it('maps every lifecycle step to the PRD vocabulary', async () => {
    const { driver: jashim, poolId } = await driverWithPool(h.app);
    const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
    const ride = await requestRide(h.app, nusrat, 'BANANI', 'MOHAKHALI');
    const phase = async () => (await request(h.app).get(`/api/v1/rides/${ride.rideRequestId}`).set(nusrat.auth)).body.data.phase;
    expect(await phase()).toBe('WAITING');
    await request(h.app).post(`/api/v1/pools/${poolId}/join`).set(nusrat.auth).send({ rideRequestId: ride.rideRequestId }).expect(200);
    expect(await phase()).toBe('MATCHED');
    await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/arrive`).set(jashim.auth).expect(200);
    expect(await phase()).toBe('MATCHED');
    await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/start`).set(jashim.auth).expect(200);
    expect(await phase()).toBe('IN_PROGRESS');
    await request(h.app).post(`/api/v1/rides/${ride.rideRequestId}/complete`).set(jashim.auth).expect(200);
    expect(await phase()).toBe('COMPLETED');
  });
});
