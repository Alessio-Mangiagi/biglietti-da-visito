import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: login → scan → save → search, on a phone viewport.
 * WebKit stands in for Safari/iPhone; Chromium for Android.
 *   pnpm build && pnpm e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cardvault/api exec tsx scripts/e2e-stack.ts',
      url: 'http://127.0.0.1:3100/api/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @cardvault/web exec vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      env: { API_URL: 'http://127.0.0.1:3100' },
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
