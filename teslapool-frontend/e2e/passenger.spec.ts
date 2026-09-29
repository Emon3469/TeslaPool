import { expect, test, type Page } from '@playwright/test';
import { Api, bdt, failOnPageErrors, loginUi, ready, resetDemo } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe.configure({ mode: 'serial' });

let page: Page;
let nusrat: Api;
let poolId: string;
let rideId: string;
let noErrors: () => void;

test.beforeAll(async ({ browser }) => {
  ({ poolId } = await resetDemo());
  nusrat = await Api.as('nusrat');
  page = await browser.newPage();
  noErrors = failOnPageErrors(page);
  await loginUi(page, 'nusrat');
});

test.afterAll(async () => {
  noErrors();
  await page.close();
  await nusrat.dispose();
  await resetDemo();
});

test('dashboard shows the user, wallet balance and a ride form', async () => {
  const me: any = await nusrat.get('/auth/me');
  const wallet: any = await nusrat.get('/wallet');
  await page.goto('/passenger');
  await expect(page.getByText(new RegExp(`Good (morning|afternoon|evening), ${me.name.split(' ')[0]}\\.`))).toBeVisible();
  await expect(page.locator('a[href="/wallet"]').getByText(bdt(wallet.balance.amountPoysha))).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Request a ride' })).toBeVisible();
});

test('request a ride: live price preview equals the fare prediction', async () => {
  const preview = page.waitForResponse((r) => r.url().includes('/api/v1/predictions/fare') && r.request().method() === 'POST');
  await page.goto('/ride/new?pickup=BANANI&dropoff=MOHAKHALI');
  const fare = (await (await preview).json()).data;
  const card = page.locator('div.on-lime.rounded-3xl').first();
  await expect(card.locator('p.text-5xl')).toHaveText(bdt(fare.predictedFare.amountPoysha));
  await expect(card).toContainText(`~${Math.round(fare.predictedDurationMinutes)} min`);
});

test('submit: the matching page shows the created ride exactly', async () => {
  await ready(page);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/rides') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Request & find pools' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const ride = (await res.json()).data;
  rideId = ride.rideRequestId;
  await page.waitForURL(`**/rides/${rideId}/matches`);

  await expect(page.locator('div.on-lime.rounded-3xl p.text-5xl')).toHaveText(bdt(ride.estimatedFare.amountPoysha));
  const row = (label: RegExp) => page.locator('dl > div', { hasText: label }).locator('dd');
  await expect(row(/^Base fare/)).toHaveText(bdt(ride.fareBreakdown.base.amountPoysha));
  await expect(row(/^Distance ·/)).toHaveText(bdt(ride.fareBreakdown.distanceCharge.amountPoysha));
  await expect(row(/^Time ·/)).toHaveText(bdt(ride.fareBreakdown.timeCharge.amountPoysha));
  await expect(row(/^Standard fare/)).toHaveText(bdt(ride.fareBreakdown.total.amountPoysha));
  // The breakdown adds up to the quote, to the poysha.
  expect(ride.fareBreakdown.base.amountPoysha + ride.fareBreakdown.distanceCharge.amountPoysha + ride.fareBreakdown.timeCharge.amountPoysha).toBe(ride.fareBreakdown.total.amountPoysha);

  const feasible = ride.poolOptions.filter((o: any) => o.decision === 'MATCHED');
  await expect(page.getByRole('heading', { name: `${feasible.length} pool${feasible.length > 1 ? 's' : ''} can take you` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join this pool' })).toHaveCount(feasible.length);
  const bullet = ride.poolOptions.find((o: any) => o.poolId === poolId);
  expect(bullet.decision).toBe('MATCHED');
  await expect(page.getByText(bullet.headline).first()).toBeVisible();
});

test('join: the ride page shows driver, vehicle and fare from the API', async () => {
  const joined = page.waitForResponse((r) => r.url().includes(`/api/v1/pools/${poolId}/join`));
  await page.getByRole('button', { name: 'Join this pool' }).first().click();
  expect((await (await joined).json()).data.decision).toBe('MATCHED');
  await page.waitForURL(`**/rides/${rideId}`);

  const ride: any = await nusrat.get(`/rides/${rideId}`);
  const expl: any = await nusrat.get(`/rides/${rideId}/explanation`);
  expect(ride.status).toBe('MATCHED');
  await expect(page.getByText(`${expl.trip.driverFirstName} · ${expl.trip.vehicle.name}`)).toBeVisible();
  await expect(page.getByText(expl.trip.vehicle.registrationNumber)).toBeVisible();
  await expect(page.locator('section[aria-labelledby="fare-h"] p.text-5xl')).toHaveText(bdt(ride.pool.fare.amountPoysha));
  await expect(page.getByRole('heading', { name: 'Why you were matched' })).toBeVisible();
  for (const reason of expl.match.reasons) await expect(page.getByText(reason.message).first()).toBeVisible();
});

test('pool view and raw event log agree with the API', async () => {
  await page.getByRole('link', { name: /Open pool view/ }).click();
  await page.waitForURL(`**/pools/${poolId}`);
  const pool: any = await nusrat.get(`/pools/${poolId}`);
  await expect(page.getByText(`${pool.occupiedSeats} / ${pool.capacity} taken · ${pool.availableSeats} free`)).toBeVisible();
  await expect(page.getByText('(you)')).toBeVisible();

  await page.goto(`/rides/${rideId}`);
  const events: any[] = await nusrat.get(`/rides/${rideId}/events`);
  await page.locator('summary', { hasText: 'Event log' }).click();
  await expect(page.locator('details table tbody tr')).toHaveCount(events.length);
});

test('cancel: status changes in the UI and in the API; history shows it', async () => {
  await ready(page);
  await page.getByRole('button', { name: 'Cancel ride' }).click();
  await expect(page.locator('main').getByText('Cancelled', { exact: true }).first()).toBeVisible();
  const ride: any = await nusrat.get(`/rides/${rideId}`);
  expect(ride.status).toBe('CANCELLED');

  await page.goto('/rides');
  const first = page.locator('main ul li').first();
  await expect(first).toContainText('Banani');
  await expect(first).toContainText('Mohakhali');
  await expect(first).toContainText('Cancelled');
});

test('wallet top-up credits exactly the amount entered', async () => {
  const before: any = await nusrat.get('/wallet');
  await page.goto('/wallet');
  await ready(page);
  await page.getByLabel('Amount (৳)').fill('1');
  const topUp = page.waitForResponse((r) => r.url().includes('/api/v1/wallet/top-up'));
  await page.getByRole('button', { name: 'Add ৳1.00' }).click();
  expect((await topUp).status()).toBe(201);
  const after: any = await nusrat.get('/wallet');
  expect(after.balance.amountPoysha - before.balance.amountPoysha).toBe(100);
  await expect(page.locator('p.text-5xl')).toHaveText(bdt(after.balance.amountPoysha));
  await expect(page.locator('ul li').first()).toContainText('+৳1.00');
});

test('profile: validation and a saved change round-trip through the API', async () => {
  const me: any = await nusrat.get('/auth/me');
  await page.goto('/profile');
  await ready(page);
  const phone = page.getByLabel('Phone');
  await phone.fill('12ab');
  await expect(page.getByText('Use digits only, e.g. +8801712345678.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

  await phone.fill('+8801711999999');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved')).toBeVisible();
  expect(((await nusrat.get('/auth/me')) as any).phone).toBe('+8801711999999');

  // Restore the seeded phone number.
  await phone.fill(me.phone ?? '');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved').last()).toBeVisible();
  expect(((await nusrat.get('/auth/me')) as any).phone).toBe(me.phone);
});

test('prediction lab shows the ETA and fare decision returned by the API', async () => {
  await page.goto('/intelligence#lab');
  await ready(page);
  const eta = page.waitForResponse((r) => r.url().includes('/api/v1/predictions/eta'));
  const fare = page.waitForResponse((r) => r.url().includes('/api/v1/predictions/fare'));
  await page.getByRole('button', { name: 'Run models' }).click();
  const etaData = (await (await eta).json()).data;
  const fareData = (await (await fare).json()).data;
  const lab = page.locator('#lab');
  await expect(lab.getByText(`${Math.round(etaData.predictedDurationMinutes)} min`, { exact: true })).toBeVisible();
  await expect(lab.locator('section[aria-labelledby="fare-h"] p.text-4xl')).toHaveText(bdt(fareData.fareDecision.finalFarePoysha));
  await expect(lab).toContainText(`Allowed band ${bdt(fareData.fareDecision.allowedBand.minPoysha)} – ${bdt(fareData.fareDecision.allowedBand.maxPoysha)}`);
});
