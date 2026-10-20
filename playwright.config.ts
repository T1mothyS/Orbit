import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Browser tests never boot the production API, load .env or open a business database.
const scope = process.env.ORBIT_UI_SCOPE || 'all';
if (!['all', 'gallery', 'app'].includes(scope) || (process.env.CI && scope !== 'all')) throw new Error('CI requires the complete UI scope');
export default defineConfig({
  testDir: './tests/ui',
  testMatch: scope === 'gallery' ? '**/gallery.spec.ts' : scope === 'app' ? ['**/account.spec.ts', '**/settings.spec.ts', '**/stage2.spec.ts', '**/round3.spec.ts', '**/round4.spec.ts', '**/evolution.spec.ts', '**/confirmations.spec.ts'] : '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: true,
  // Real login fixtures share the server's IP budget; keep the expanded matrix within it.
  workers: 2,
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
  webServer: [...(scope !== 'app' ? [{
    command: 'npm run dev:ui',
    url: 'http://127.0.0.1:4196/dev/ui',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  }] : []), ...(scope !== 'gallery' ? [{
    command: 'node --import tsx scripts/orbit-ui-preview.ts 4187 --iteration --account-ui',
    url: 'http://127.0.0.1:4187/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  }] : [])],
});
