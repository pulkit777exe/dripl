import { defineConfig, devices } from '@playwright/test';

const requestedE2ePort = Number(process.env.E2E_PORT ?? 3100);
const e2ePort =
  Number.isInteger(requestedE2ePort) && requestedE2ePort > 0 ? requestedE2ePort : 3100;

// Point the suite at an already-running server instead of starting a dev one.
// This is how the production Docker stack gets exercised: the default `pnpm
// start` path in a container is not the dev server, and starting a second dev
// server would test the wrong artifact.
const externalBaseUrl = process.env.E2E_BASE_URL;
const e2eBaseUrl = externalBaseUrl ?? `http://127.0.0.1:${e2ePort}`;

// Retina capture. Frame cost scales with backing-store pixels, so a DPR-1 run
// says nothing about a DPR-2 display. Opt-in because it roughly quadruples the
// pixels the canvas has to fill.
const requestedScale = Number(process.env.E2E_DEVICE_SCALE_FACTOR ?? 1);
const deviceScaleFactor =
  Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor },
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: `pnpm dev --port ${e2ePort}`,
          url: e2eBaseUrl,
          reuseExistingServer: false,
          timeout: 120000,
        },
      }),
});
