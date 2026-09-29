import { expect, test } from '@playwright/test';
import { Api, bdt, failOnPageErrors } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
let meta: any;
test.beforeAll(async () => {
  const api = await Api.anonymous();
  meta = await api.get('/meta');
  await api.dispose();
});

const pct = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(0)}%`);

test('home: every section renders and hero metrics equal the API', async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  const api = await Api.anonymous();
  const impact: any = await api.get('/stats/impact');
  await page.goto('/');

  const metric = (label: string) => page.locator('dl > div', { hasText: label }).locator('dd');
  await expect(metric('Dhaka zones')).toHaveText(String(meta.zones.length));
  await expect(metric('Max pool saving')).toHaveText(`${meta.fare.maxPoolDiscountPercent}%`);
  await expect(metric('Overbookings')).toHaveText(String(impact.integrity.capacityViolations));

  for (const heading of [/Together, We Make a/, /Challenging empty seats/, /Our\s+Service/, /Your safety\s+is our priority/, /Social impact\s+making a difference/, /Right now\s+at TeslaPool/, /From Empty Seats to Shared Journeys/]) {
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
  await expect(page.getByRole('link', { name: /Pooled Tesla rides now run across ten Dhaka zones/ })).toBeVisible();
  await expect(page.locator('footer')).toContainText('TeslaPool');
  await api.dispose();
  noErrors();
});

test('how it works: live rules and a fare calculator that matches the API formula', async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto('/how-it-works');
  await expect(page.getByText(`A Tesla carries at most ${meta.rules.poolMaxCapacity} passengers`)).toBeVisible();
  await expect(page.getByText(`No passenger’s detour may exceed ${meta.rules.maxDetourKm} km`)).toBeVisible();

  // Calculator defaults: Banani → Mohakhali, 20 min, 50 % shared. Recompute with the published formula.
  const km = meta.distanceKm.BANANI?.MOHAKHALI ?? meta.distanceKm.MOHAKHALI.BANANI;
  const half = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
  const solo = meta.fare.basePoysha + half(Math.round(km * 1000) * meta.fare.perKmPoysha, 1000) + half(20 * 60 * meta.fare.perMinPoysha, 60);
  const maxBps = Math.round(meta.fare.maxPoolDiscountPercent * 100);
  const pooled = half(solo * (10_000 - Math.round((maxBps * 50) / 100)), 10_000);
  const calc = page.locator('#calculator');
  await expect(calc.locator('div', { hasText: /^Standard \(solo\) fare/ }).locator('dd')).toHaveText(bdt(solo));
  await expect(calc.getByText(bdt(pooled), { exact: true })).toBeVisible();

  // Changing the trip time changes the time charge exactly.
  await calc.locator('#calc-min').fill('40');
  const solo40 = meta.fare.basePoysha + half(Math.round(km * 1000) * meta.fare.perKmPoysha, 1000) + half(40 * 60 * meta.fare.perMinPoysha, 60);
  await expect(calc.locator('div', { hasText: /^Standard \(solo\) fare/ }).locator('dd')).toHaveText(bdt(solo40));
  noErrors();
});

test('safety: seat guarantee shows the live integrity numbers', async ({ page }) => {
  const api = await Api.anonymous();
  const impact: any = await api.get('/stats/impact');
  await page.goto('/safety');
  const seat = page.locator('#seat-guarantee');
  await expect(seat).toContainText(`capacity violations across ${impact.integrity.checkedPools} pools`);
  await expect(seat.locator('.text-5xl')).toHaveText(String(impact.integrity.capacityViolations));
  await expect(page.getByText('In an emergency, call 999')).toBeVisible();
  await api.dispose();
});

test('impact: KPIs and integrity checks equal /stats/impact', async ({ page }) => {
  const api = await Api.anonymous();
  const impact: any = await api.get('/stats/impact');
  await page.goto('/impact');
  const kpi = (label: string) => page.locator('div.rounded-3xl', { has: page.getByText(label, { exact: true }) }).locator('p').nth(1);
  await expect(kpi('Match success')).toHaveText(pct(impact.matching.matchSuccessRate));
  await expect(kpi('Seat utilisation')).toHaveText(pct(impact.occupancy.seatUtilization));
  await expect(kpi('Passenger savings')).toHaveText(bdt(impact.pooling.totalPassengerSavings.amountPoysha));
  const check = (label: string) => page.locator('li', { hasText: label }).locator('span').last();
  await expect(check('Capacity violations')).toHaveText(String(impact.integrity.capacityViolations));
  await expect(check('Wallet balance drift')).toHaveText(String(impact.integrity.walletBalanceDrift));
  await api.dispose();
});

test('areas: all zones with exact coordinates and graph distances', async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await page.goto('/areas');
  const cards = page.getByRole('button', { pressed: false }).filter({ has: page.locator('span.font-mono') });
  await expect(cards).toHaveCount(meta.zones.length - 1); // the selected one is pressed
  const uttara = meta.zones.find((z: any) => z.code === 'UTTARA');
  await page.getByRole('button', { name: new RegExp(`^${uttara.name}`) }).last().click();
  await expect(page.getByRole('heading', { name: uttara.name, level: 2, exact: true })).toBeVisible();
  await expect(page.getByText(`${uttara.center.lat.toFixed(4)}° N, ${uttara.center.lng.toFixed(4)}° E`)).toBeVisible();
  const km = meta.distanceKm.UTTARA?.BANANI ?? meta.distanceKm.BANANI.UTTARA;
  await expect(page.locator('li', { hasText: /^Banani/ }).first()).toContainText(`${km} km`);
  await expect(page.locator('.leaflet-container')).toBeVisible();
  noErrors();
});

test('intelligence: health, rules and distance matrix come from the API', async ({ page }) => {
  await page.goto('/intelligence');
  await expect(page.locator('#health')).toContainText('PostgreSQL');
  await expect(page.locator('#health').getByText('up', { exact: true })).toBeVisible();
  await expect(page.locator('#engine')).toContainText(`${meta.rules.maxStops}`);
  const cell = page.locator('#zones table tr', { has: page.locator('th', { hasText: /^Banani$/ }) }).locator('td').nth(2);
  const km = meta.distanceKm.BANANI?.MOHAKHALI ?? meta.distanceKm.MOHAKHALI.BANANI;
  await expect(cell).toHaveText(String(km));
  await expect(page.getByRole('link', { name: 'Log in to try it' })).toBeVisible();
});

test('newsroom, article, static pages and 404', async ({ page }) => {
  await page.goto('/news');
  const articles = page.locator('article');
  await expect(articles).toHaveCount(4);
  await articles.first().getByRole('link').click();
  await expect(page).toHaveURL(/\/news\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const [path, text] of [
    ['/about', 'for Dhaka’s streets'],
    ['/drive', 'Fill every seat of'],
    ['/terms', 'Terms of use'],
    ['/privacy', 'What co-riders see'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator('main')).toContainText(text);
  }
  const res = await page.goto('/this-page-does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page.getByText('not on the route')).toBeVisible();
});

test('mobile: no horizontal scroll and the menu opens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/', '/how-it-works', '/areas', '/login', '/register']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.locator('#mobile-nav')).toContainText('How it works');
});
