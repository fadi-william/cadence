import { defineConfig, devices } from '@playwright/test';

/** Port of the API under test (`E2E_API_PORT`). */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
/** Port of the web dev server under test (`E2E_WEB_PORT`). */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4300);

/**
 * End-to-end tests against the real API and Angular dev server.
 * The API runs on a dedicated database (E2E_DATABASE_URL, default cadence_e2e) that is reset on start.
 * Tests are stateful and run serially in file-name order (01-first-launch, 02-organization, ...), each
 * building on the data the previous files created.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/start-api.mjs',
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { E2E_API_PORT: String(API_PORT), E2E_WEB_PORT: String(WEB_PORT) },
    },
    {
      command: `npm run start -w @cadence/web -- --port ${WEB_PORT}`,
      cwd: '../..',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
