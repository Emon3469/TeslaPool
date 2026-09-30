import { expect, test } from '@playwright/test';
import { Api, failOnPageErrors, loginUi, ready, resetDemo } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe.configure({ mode: 'serial' });

let poolId: string;
test.beforeAll(async () => {
  ({ poolId } = await resetDemo());
});
test.afterAll(async () => {
  await resetDemo();
});

test('Nusrat books an urgent ride; with flexible Rafiq, Bullet goes to Mohakhali first and Jashim sees why', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const noErrors = failOnPageErrors(page);
  await loginUi(page, 'nusrat');
  await page.goto('/ride/new?pickup=BANANI&dropoff=MOHAKHALI');
  await ready(page);
  await page.getByText('Urgent', { exact: true }).click();
  await expect(page.getByText('The car goes your way first.')).toBeVisible();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/rides') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Request & find pools' }).click();
  const ride = (await (await created).json()).data;
  expect(ride.flexibility).toBe('URGENT');
  noErrors();
  await ctx.close();

  const nusrat = await Api.as('nusrat');
  await nusrat.post(`/pools/${poolId}/join`, { rideRequestId: ride.rideRequestId });
  const rafiq = await Api.as('rafiq');
  const r: any = await rafiq.post('/rides', { pickupZone: 'BANANI', dropoffZone: 'GULSHAN', flexibility: 'FLEXIBLE' });
  const joined: any = await rafiq.post(`/pools/${poolId}/join`, { rideRequestId: r.rideRequestId });
  expect(joined.route).toEqual(['BANANI', 'MOHAKHALI', 'GULSHAN']);

  const dctx = await browser.newContext();
  const driver = await dctx.newPage();
  await loginUi(driver, 'jashim');
  await driver.goto('/driver');
  const poolCard = driver.locator('section[aria-labelledby="pool-h"]');
  await expect(poolCard).toContainText('Urgent');
  await expect(poolCard).toContainText('Flexible');
  await expect(poolCard.locator('ol li')).toHaveText([/Banani/, /Mohakhali/, /Gulshan/]);
  await dctx.close();
  await Promise.all([nusrat.dispose(), rafiq.dispose()]);
});
