/**
 * PRD §5: "the evaluator must be able to test the calculation by hand using Nusrat and Rafiq's trip."
 * Every number below is the worked example in README "Fare model: worked example", computed by hand:
 *
 *   solo fare     = base ৳50 + distance × ৳20/km + minutes × ৳0.50/min      (minutes = km × 5.0 at MEDIUM traffic)
 *   Nusrat solo   = 5000 + 3.4 × 2000 + 17.0 × 50   = 5000 + 6800 + 850 = 12650 poysha (৳126.50)
 *   Rafiq  solo   = 5000 + 2.5 × 2000 + 12.5 × 50   = 5000 + 5000 + 625 = 10625 poysha (৳106.25)
 *   pooled route Banani → Gulshan 1 → Mohakhali (2.5 km + 2.0 km)
 *   Rafiq  shares 2.5 of 2.5 km = 100%  → discount min(25%, 25% × 1.0000) = 25.00% → 10625 × 0.7500 = 7968.75 → 7969
 *   Nusrat shares 2.5 of 4.5 km = 55.56% → discount min(25%, 25% × 0.5556) = 13.89% → 12650 × 0.8611 = 10892.92 → 10893
 */
import request from 'supertest';
import { CONTEXT, driverWithPool, makeHarness, registerUser, resetDb } from '../helpers/harness';

const h = makeHarness();
beforeAll(() => resetDb(h.prisma));
afterAll(() => h.close());

it('Nusrat and Rafiq’s pooled fares match the hand calculation to the poysha, and are settled exactly', async () => {
  const { driver: jashim, poolId } = await driverWithPool(h.app);
  const nusrat = await registerUser(h.app, 'PASSENGER', 'Nusrat Jahan');
  const rafiq = await registerUser(h.app, 'PASSENGER', 'Rafiq Islam');
  await request(h.app).post('/api/v1/wallet/top-up').set(rafiq.auth).send({ amountPoysha: 50_000 }).expect(201);

  const n = await request(h.app).post('/api/v1/rides').set(nusrat.auth).send({ pickupZone: 'Banani', dropoffZone: 'Mohakhali', context: CONTEXT }).expect(201);
  expect(n.body.data.fareBreakdown).toMatchObject({
    base: { amountPoysha: 5000 }, distanceCharge: { amountPoysha: 6800 }, timeCharge: { amountPoysha: 850 }, total: { amountPoysha: 12650 },
    distanceKm: 3.4, pricingDurationMinutes: 17, trafficLevel: 'MEDIUM',
  });
  expect(n.body.data.estimatedFare).toEqual({ amountPoysha: 12650, amountBdt: 126.5, currency: 'BDT' });

  const r = await request(h.app).post('/api/v1/rides').set(rafiq.auth).send({ pickupZone: 'Banani', dropoffZone: 'Gulshan 1', paymentMethod: 'TESLAPAY', context: CONTEXT }).expect(201);
  expect(r.body.data.fareBreakdown).toMatchObject({ base: { amountPoysha: 5000 }, distanceCharge: { amountPoysha: 5000 }, timeCharge: { amountPoysha: 625 }, total: { amountPoysha: 10625 }, pricingDurationMinutes: 12.5 });

  await request(h.app).post(`/api/v1/pools/${poolId}/join`).set(nusrat.auth).send({ rideRequestId: n.body.data.rideRequestId }).expect(200);
  const rJoin = await request(h.app).post(`/api/v1/pools/${poolId}/join`).set(rafiq.auth).send({ rideRequestId: r.body.data.rideRequestId }).expect(200);
  expect(rJoin.body.data.route).toEqual(['BANANI', 'GULSHAN', 'MOHAKHALI']);
  expect(rJoin.body.data.fare).toMatchObject({ soloFarePoysha: 10625, sharedFraction: 1, discountBps: 2500, farePoysha: 7969 });

  const nRide = (await request(h.app).get(`/api/v1/rides/${n.body.data.rideRequestId}`).set(nusrat.auth)).body.data;
  expect(nRide.pool).toMatchObject({ soloFare: { amountPoysha: 12650 }, discountPercent: 13.89, fare: { amountPoysha: 10893, amountBdt: 108.93 } });

  // Jashim completes both trips: Nusrat pays cash, Rafiq pays from TeslaPay.
  for (const id of [n.body.data.rideRequestId, r.body.data.rideRequestId]) {
    for (const step of ['arrive', 'start', 'complete']) await request(h.app).post(`/api/v1/rides/${id}/${step}`).set(jashim.auth).expect(200);
  }
  const nDone = (await request(h.app).get(`/api/v1/rides/${n.body.data.rideRequestId}`).set(nusrat.auth)).body.data;
  const rDone = (await request(h.app).get(`/api/v1/rides/${r.body.data.rideRequestId}`).set(rafiq.auth)).body.data;
  expect(nDone).toMatchObject({ phase: 'COMPLETED', finalFare: { amountPoysha: 10893 }, payment: { method: 'CASH', amount: { amountPoysha: 10893 } } });
  expect(rDone).toMatchObject({ phase: 'COMPLETED', finalFare: { amountPoysha: 7969 }, payment: { method: 'TESLAPAY', amount: { amountPoysha: 7969 } } });

  // Wallets: Rafiq 50000 - 7969 = 42031; Jashim earned 7969 (cash is collected physically, not in the wallet).
  expect((await request(h.app).get('/api/v1/wallet').set(rafiq.auth)).body.data.balance.amountPoysha).toBe(42_031);
  const jWallet = (await request(h.app).get('/api/v1/wallet').set(jashim.auth)).body.data;
  expect(jWallet.balance.amountPoysha).toBe(7969);
  expect(jWallet.transactions[0]).toMatchObject({ type: 'RIDE_EARNING', amount: { amountPoysha: 7969 }, rideRequestId: r.body.data.rideRequestId });

  const impact = (await request(h.app).get('/api/v1/stats/impact')).body.data;
  expect(impact.payments).toMatchObject({ settled: 2, cash: { amountPoysha: 10893 }, teslaPay: { amountPoysha: 7969 } });
  expect(impact.pooling.totalPassengerSavings.amountPoysha).toBe((12650 - 10893) + (10625 - 7969));
  expect(impact.integrity).toMatchObject({ capacityViolations: 0, walletBalanceDrift: 0, completedRidesWithoutPayment: 0, paymentAmountMismatches: 0 });
});
