import { defineConfig } from '@playwright/test';

/**
 * End-to-end suite: drives the real web app (production build) against the real API and checks that
 * every page shows exactly what the API returned.
 *
 *   npm run test:e2e            # starts the API (:4000) and the web app (:3000) if they are not running
 *
 * The API is started with Brevo disabled, so nothing in the suite can send a real email.
 * Tests share one database, so they run in order with a single worker.
 */
const WEB = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: WEB,
    // Local runs use the installed Microsoft Edge (no browser download); CI uses Playwright's Chromium.
    channel: isCI ? undefined : (process.env.E2E_BROWSER_CHANNEL ?? 'msedge'),
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm --prefix ../teslapool-backend run dev',
      url: `${API}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { PORT: '4000', BREVO_API_KEY: '', CORS_ORIGINS: WEB },
    },
    {
      command: 'npm run build && npm run start',
      url: WEB,
      reuseExistingServer: true,
      timeout: 600_000,
      env: { BACKEND_URL: API },
    },
  ],
});
