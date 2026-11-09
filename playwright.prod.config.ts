import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test of a real deployment (default: production on Vercel).
 *   E2E_BASE_URL=https://cardvault-pearl.vercel.app pnpm e2e:prod
 * Creates a throwaway account (public Mailinator inbox) and deletes it at the end.
 * Each run e-mails a new recipient: AgentMail allows few distinct recipients on young
 * accounts (10 in the first 24 h), so run it sparingly.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /prod\.spec/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://cardvault-pearl.vercel.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
