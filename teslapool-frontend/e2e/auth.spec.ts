import { expect, test } from '@playwright/test';
import { Api, CAST, failOnPageErrors, loginUi, ready } from './helpers';

test('signed-out visitors are sent to login and come back after', async ({ page }) => {
  await page.goto('/wallet');
  await expect(page).toHaveURL(/\/login\?next=%2Fwallet$/);
  await ready(page);
  await page.getByRole('button', { name: /Nusrat Jahan/ }).click();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole('heading', { name: 'TeslaPay', level: 1 })).toBeVisible();
});

test('wrong password shows a clear error and signs nobody in', async ({ page }) => {
  await page.goto('/login');
  await ready(page);
  await page.getByLabel('Email').fill(CAST.nusrat.email);
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

for (const [who, home, heading] of [
  ['nusrat', '/passenger', 'Dashboard'],
  ['jashim', '/driver', 'Driver dashboard'],
  ['ops', '/ops', 'Ops console'],
] as const) {
  test(`${who} lands on the right home and the header knows the session`, async ({ page }) => {
    const noErrors = failOnPageErrors(page);
    const api = await Api.as(who);
    const me = await api.get<{ name: string; role: string }>('/auth/me');
    await loginUi(page, who);
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: `Account menu for ${me.name}` })).toBeVisible();
    await api.dispose();
    noErrors();
  });
}

test('logout goes straight to the login page and really ends the session', async ({ page }) => {
  await loginUi(page, 'nusrat');
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/);
  await expect(page.getByText('You’ve been logged out.')).toBeVisible();
  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status()).toBe(401);
  await page.goto('/passenger');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('register: validation messages and duplicate email (nothing is created)', async ({ page }) => {
  await page.goto('/register');
  await ready(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Tell us your name.')).toBeVisible();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByText('At least 8 characters.').first()).toBeVisible();

  await page.getByLabel('Full name').fill('Nusrat Again');
  await page.getByLabel('Email').fill(CAST.nusrat.email);
  await page.getByLabel('Password').fill('long-enough-password');
  const res = page.waitForResponse('**/api/v1/auth/register');
  await page.getByRole('button', { name: 'Create account' }).click();
  expect((await res).status()).toBe(409);
  await expect(page.getByText('An account with this email already exists.')).toBeVisible();

  // Picking "Drive" changes the submit button, proving the role choice reaches the form.
  await page.getByText('Offer my seats').click();
  await expect(page.getByRole('button', { name: 'Create driver account' })).toBeVisible();
});

test('forgot password never reveals whether an account exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.waitForURL(/\/forgot-password/);
  await ready(page);
  await page.getByLabel('Email').fill('nobody-e2e@teslapool.test');
  const res = page.waitForResponse('**/api/v1/auth/password/forgot');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  expect((await res).status()).toBe(202);
  await expect(page).toHaveURL(/\/reset-password\?email=nobody-e2e%40teslapool\.test&sent=1/);
  await expect(page.getByText('If an account exists for that email, a code is on its way.')).toBeVisible();
});

test('the login page recognises an existing session', async ({ page }) => {
  await loginUi(page, 'rafiq');
  await page.goto('/login');
  await expect(page.getByText(/You’re signed in as/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/passenger');
});
