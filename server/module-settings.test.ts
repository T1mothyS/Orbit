import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleSettingsPath } from '../src/utils/module-settings.js';
test('stable preference, publishing, export, source policy and mail links resolve to their owners', () => {
  assert.equal(moduleSettingsPath(null), null);
  assert.equal(moduleSettingsPath('library-personal-preferences'), '/settings/profile');
  for(const id of ['library-full-export','setting-library-16152wn','settings-library'])assert.equal(moduleSettingsPath(id),'/library/settings');
  for(const id of ['setting-daily-report-17lgo36','setting-daily-report-16vp9eg','setting-notifications-1ov9hhr'])assert.equal(moduleSettingsPath(id),'/reports/settings');
  assert.equal(moduleSettingsPath('setting-notifications-x4nqrq'),null);
});
