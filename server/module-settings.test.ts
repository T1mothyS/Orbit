import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleSettingsPath } from '../src/utils/module-settings.js';
test('stable preference, publishing, export, source policy and mail links resolve to their owners', () => {
  assert.equal(moduleSettingsPath(null), null);
  assert.equal(moduleSettingsPath('library-personal-preferences'), '/settings/account/profile');
  for(const id of ['library-full-export','setting-library-16152wn','settings-library'])assert.equal(moduleSettingsPath(id),'/settings/library');
  assert.equal(moduleSettingsPath('setting-daily-report-17lgo36'),'/settings/reports');
  for(const id of ['setting-daily-report-16vp9eg','setting-notifications-1ov9hhr'])assert.equal(moduleSettingsPath(id),'/settings/reports/delivery');
  assert.equal(moduleSettingsPath('statistics-filters'),'/settings/statistics');
  assert.equal(moduleSettingsPath('statistics-history'),'/settings/statistics/history');
  assert.equal(moduleSettingsPath('setting-notifications-x4nqrq'),'/settings/notifications');
  for (const id of ['account', 'settings-account', 'account-password', 'setting-account-m2enu0', 'setting-account-3jrccd', 'setting-account-i5oc5l']) assert.equal(moduleSettingsPath(id), '/settings/account');
});
