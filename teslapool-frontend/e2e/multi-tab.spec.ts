import { expect, test, type BrowserContext } from '@playwright/test';
import { Api, CAST, failOnPageErrors, loginUi, ready, resetDemo } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe.configure({ mode: 'serial' });

/**
 * One browser window, several tabs: they share a single session cookie. Signing in as Jashim in one tab
 * must never turn Nusrat's open tab into Jashim's (no driver dashboard, no ride booked as the driver).
 */

test.beforeAll(async () => {
  await resetDemo();
});
test.afterAll(async () => {
  await resetDemo();
});

async function nusratActiveRides(): Promise<number> {
  const nusrat = await Api.as('nusrat');
  const rides: any[] = await nusrat.get('/rides?status=ACTIVE&limit=10');
  await nusrat.dispose();
  return rides.length;
}

test('signing in as the driver in another tab pauses the passenger tab; nothing is booked', async ({ browser }) => {
  const ctx: BrowserContext = await browser.newContext();
  const passengerTab = await ctx.newPage();
  const noErrors = failOnPageErrors(passengerTab);
  await loginUi(passengerTab, 'nusrat');
  await passengerTab.goto('/ride/new?pickup=BANANI&dropoff=MOHAKHALI');
  await ready(passengerTab);
  await expect(passengerTab.getByRole('button', { name: 'Request & find pools' })).toBeVisible();

  // Tab 2 (same window): Jashim signs in.
  const driverTab = await ctx.newPage();
  await loginUi(driverTab, 'jashim');
  await expect(driverTab).toHaveURL(/\/driver/);

  // Tab 1 is told immediately, stays on its page, and is paused.
  const gate = passengerTab.getByRole('alertdialog');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText('This tab is paused');
  await expect(gate).toContainText('signed in as Nusrat');
  await expect(gate).toContainText('Another tab signed in as Jashim');
  await expect(passengerTab).toHaveURL(/\/ride\/new/);
  await expect(passengerTab.getByRole('heading', { level: 1, name: 'Driver dashboard', includeHidden: true })).toHaveCount(0);
  await expect(passengerTab.getByRole('heading', { level: 1, name: 'Request a ride', includeHidden: true })).toBeVisible();
  expect(await nusratActiveRides()).toBe(0);

  // Choosing to sign back in as Nusrat returns her to the booking page; now the driver tab is the paused one.
  await gate.getByRole('button', { name: 'Sign in as Nusrat again' }).click();
  await passengerTab.waitForURL(/\/login/);
  await ready(passengerTab);
  await passengerTab.getByRole('button', { name: new RegExp(CAST.nusrat.button) }).click();
  await passengerTab.getByRole('button', { name: 'Log in', exact: true }).click();
  await passengerTab.waitForURL(/\/ride\/new/);
  await expect(passengerTab.getByRole('button', { name: 'Request & find pools' })).toBeVisible();
  await expect(driverTab.getByRole('alertdialog')).toContainText('This tab is paused');

  noErrors();
  await ctx.close();
});

test('if the session changes without a broadcast, the API refuses the booking and the tab pauses', async ({ browser }) => {
  const ctx = await browser.newContext();
  const passengerTab = await ctx.newPage();
  await loginUi(passengerTab, 'nusrat');
  await passengerTab.goto('/ride/new?pickup=BANANI&dropoff=MOHAKHALI');
  await ready(passengerTab);

  // Replace the shared cookie behind the page's back (e.g. a tab whose broadcast was missed).
  const res = await ctx.request.post('/api/v1/auth/login', { data: { email: CAST.jashim.email, password: CAST.jashim.password } });
  expect(res.status()).toBe(200);

  const booking = passengerTab.waitForResponse((r) => r.url().endsWith('/api/v1/rides') && r.request().method() === 'POST');
  await passengerTab.getByRole('button', { name: 'Request & find pools' }).click();
  const refused = await booking;
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe('SESSION_ACCOUNT_CHANGED');

  await expect(passengerTab.getByRole('alertdialog')).toContainText('Jashim');
  await expect(passengerTab).toHaveURL(/\/ride\/new/);
  expect(await nusratActiveRides()).toBe(0);
  await ctx.close();
});
