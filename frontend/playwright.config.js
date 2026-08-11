import fs from 'node:fs';
import path from 'node:path';
/* global process */
import { defineConfig, devices } from '@playwright/test';

const loadRootEnv = () => {
  const envPath = path.resolve(process.cwd(), '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
};

loadRootEnv();

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1',
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    // El service worker se valida por separado. Bloquearlo en la regresión funcional
    // evita que un chunk antiguo almacenado eluda las intercepciones deterministas.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil-android', use: { ...devices['Pixel 7'] } },
  ],
});
