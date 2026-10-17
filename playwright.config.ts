import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Browser tests never boot the production API, load .env or open a business database.
export default defineConfig({
  testDir: './tests/ui',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  updateSnapshots: 'none',
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: process.env.ORBIT_UI_QA_DIR || path.join(os.tmpdir(), 'orbit-ui-tests'),
  snapshotPathTemplate: '{testDir}/baselines/{platform}/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { threshold: 0.2, maxDiffPixelRatio: 0.002, animations: 'disabled' } },
  use: {
    baseURL: 'http://127.0.0.1:4196',
    browserName: 'chromium',
    channel: process.env.ORBIT_BROWSER_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:ui',
    url: 'http://127.0.0.1:4196/dev/ui',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
