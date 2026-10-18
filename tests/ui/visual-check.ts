import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Candidate capture only writes test output. It never updates or approves a baseline.
export async function checkVisual(page: Page, name: string, approved: boolean, fullPage = true) {
  const candidates = process.env.ORBIT_UI_VISUAL_CANDIDATES === '1';
  if (!candidates && (approved || process.env.ORBIT_UI_VISUAL === 'compare')) {
    await expect(page).toHaveScreenshot(name, { fullPage });
    return;
  }
  const output = test.info().outputPath('candidates', name);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const bytes = await page.screenshot({ path: output, fullPage, animations: 'disabled' });
  const version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  fs.writeFileSync(output + '.json', JSON.stringify({
    status: 'candidate', comparisonPerformed: false, name, fullPage, version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    platform: process.platform, architecture: process.arch, node: process.version,
    browser: page.context().browser()?.version(), channel: process.env.ORBIT_BROWSER_CHANNEL || 'playwright-chromium',
    viewport: page.viewportSize(), sha256: createHash('sha256').update(bytes).digest('hex'),
    rendering: await page.evaluate(() => ({ fontFamily: getComputedStyle(document.body).fontFamily, language: document.documentElement.lang, devicePixelRatio })),
  }, null, 2) + '\n');
}
