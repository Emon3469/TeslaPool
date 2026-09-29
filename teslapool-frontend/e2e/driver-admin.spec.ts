import { expect, test, type Browser, type Page } from '@playwright/test';
import { Api, bdt, bookAndJoin, failOnPageErrors, loginUi, ready, resetDemo, type Who } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe.configure({ mode: 'serial' });

async function signedIn(browser: Browser, who: Who): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUi(page, who);
  return page;
}

let poolId: string;
test.beforeAll(async () => {
  ({ poolId } = await resetDemo());
});
test.afterAll(async () => {
  await resetDemo();
});

test('driver accepts a waiting rider; the rider is matched in the API', async ({ browser }) => {
  const arif = await Api.as('arif');
  const ride: any = await arif.post('/rides', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN' });
  const page = await signedIn(browser, 'jashim');
  const noErrors = failOnPageErrors(page);
  await page.goto('/driver');
  const accept = page.getByRole('button', { name: 'Accept Arif' });
  await expect(accept).toBeVisible();
  await accept.click();
  await expect(page.getByText('Arif joined your pool')).toBeVisible();
  await expect(page.locator('section[aria-labelledby="pool-h"]')).toContainText('Arif');
  const after: any = await arif.get(`/rides/${ride.rideRequestId}`);
  expect(after.status).toBe('MATCHED');
  expect(after.pool.poolId).toBe(poolId);
  await arif.post(`/rides/${ride.rideRequestId}/cancel`, { reason: 'E2E' });
  await arif.dispose();
  noErrors();
  await page.context().close();
});

test('driver runs a trip end to end; payment equals the fare shown', async ({ browser }) => {
  const rideId = await bookAndJoin('rafiq', 'BANANI', 'GULSHAN', poolId, 'CASH');
  const rafiq = await Api.as('rafiq');
  const matched: any = await rafiq.get(`/rides/${rideId}`);
  const page = await signedIn(browser, 'jashim');
  const noErrors = failOnPageErrors(page);
  await page.goto('/driver');
  const passengers = page.locator('section[aria-labelledby="pool-h"]');
  await expect(passengers).toContainText('Rafiq');
  await expect(passengers).toContainText(bdt(matched.pool.fare.amountPoysha));

  for (const [button, status] of [
    ['Arrived at pickup', 'DRIVER_ARRIVED'],
    ['Start trip', 'STARTED'],
    ['Complete trip', 'COMPLETED'],
  ] as const) {
    await ready(page);
    await page.getByRole('button', { name: button }).click();
    await expect.poll(async () => ((await rafiq.get(`/rides/${rideId}`)) as any).status).toBe(status);
  }

  const done: any = await rafiq.get(`/rides/${rideId}`);
  expect(done.payment.method).toBe('CASH');
  expect(done.payment.amount.amountPoysha).toBe(matched.pool.fare.amountPoysha);
  expect(done.finalFare.amountPoysha).toBe(matched.pool.fare.amountPoysha);

  // The pool is finished, so the driver is offline and can go online again from the dashboard.
  await expect(page.getByRole('button', { name: 'Go online' })).toBeVisible();
  await page.getByRole('button', { name: 'Go online' }).click();
  await expect(page.getByText(/Online · open/)).toBeVisible();

  await page.goto('/driver/history');
  const first = page.locator('main article', { hasText: 'completed' }).first();
  await expect(first).toContainText('Rafiq');
  await expect(first).toContainText(bdt(done.payment.amount.amountPoysha));

  await page.goto('/driver/vehicles');
  await expect(page.locator('main')).toContainText('DHAKA-METRO-TA-11-2233');
  await rafiq.dispose();
  noErrors();
  await page.context().close();
});

test('full Tesla: Shirin is refused with the reason, Jashim sees why, ops sees and resolves it', async ({ browser }) => {
  ({ poolId } = await resetDemo());
  await bookAndJoin('nusrat', 'BANANI', 'MOHAKHALI', poolId);
  await bookAndJoin('rafiq', 'BANANI', 'GULSHAN', poolId);
  await bookAndJoin('arif', 'BANANI', 'MOHAKHALI', poolId);
  const shirinApi = await Api.as('shirin');
  const shirinRide: any = await shirinApi.post('/rides', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN' });

  // Shirin: the matching page checks pools and explains the refusal.
  const shirin = await signedIn(browser, 'shirin');
  await shirin.goto(`/rides/${shirinRide.rideRequestId}/matches`);
  await ready(shirin);
  await shirin.getByRole('button', { name: /Check pools now|Best match for me/ }).click();
  await expect(shirin.getByText('No pool can take you right now.')).toBeVisible();
  await expect(shirin.getByText('Not matched: Only 0 seats left, 1 requested').first()).toBeVisible();
  await expect(shirin.getByRole('button', { name: 'Join this pool' })).toHaveCount(0);
  await shirin.context().close();

  // Jashim: full vehicle, Shirin listed with the same verdict and no Accept button.
  const jashim = await signedIn(browser, 'jashim');
  await jashim.goto('/driver');
  await expect(jashim.getByText('3 / 3 taken')).toBeVisible();
  await expect(jashim.getByText('All 3 seats are taken.')).toBeVisible();
  const card = jashim.locator('article', { hasText: 'Shirin' });
  await expect(card).toContainText('Not matched: Only 0 seats left, 1 requested');
  await expect(jashim.getByRole('button', { name: 'Accept Shirin' })).toHaveCount(0);
  await jashim.context().close();

  // Ops: the live pool is full; ops cancels Shirin's open request from the ride page controls.
  const ops = await signedIn(browser, 'ops');
  await ops.goto('/ops');
  const live = ops.locator('article', { hasText: 'Bullet' });
  await expect(live.getByRole('img', { name: '3 of 3 seats taken' })).toBeVisible();
  await ops.goto(`/rides/${shirinRide.rideRequestId}`);
  await ready(ops);
  await expect(ops.getByText('Operations controls')).toBeVisible();
  await ops.getByRole('button', { name: 'Cancel ride' }).first().click();
  await expect.poll(async () => ((await shirinApi.get(`/rides/${shirinRide.rideRequestId}`)) as any).status).toBe('CANCELLED');
  await ops.context().close();

  const impact: any = await (await Api.anonymous()).get('/stats/impact');
  expect(impact.integrity.capacityViolations).toBe(0);
  await shirinApi.dispose();
});
