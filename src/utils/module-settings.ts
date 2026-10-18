import { SETTINGS_REGISTRY } from './settings-registry.js';
const sections: Record<string, string> = {
  account: 'account', ai: 'ai', notifications: 'notifications', 'daily-report': 'reports', 'report-email': 'reports', 'report-personalization': 'reports',
  library: 'library', mail: 'reports', caldav: 'integrations', guides: 'integrations', data: 'data', tools: 'advanced', admin: 'advanced',
};
export function resolveSetting(id: string, admin = false): { kind: 'known'; path: string } | { kind: 'unknown' | 'forbidden' } {
  if (id === 'library-personal-preferences') return { kind: 'known', path: '/settings/account/profile' };
  const section = id.startsWith('settings-') ? id.slice(9) : id;
  if (sections[section]) return section === 'admin' && !admin ? { kind: 'forbidden' } : { kind: 'known', path: `/settings/${sections[section]}` };
  const item = SETTINGS_REGISTRY.find(item => item.id === id);
  if (!item) return { kind: 'unknown' };
  if (item.admin && !admin || /android-(?:fcm|local)-test/.test(id)) return { kind: 'forbidden' };
  const category = id === 'setting-notifications-1ov9hhr' ? 'reports' : sections[item.section];
  return category ? { kind: 'known', path: `/settings/${category}` } : { kind: 'unknown' };
}
/** Mapping is metadata only; callers must still check role with resolveSetting. */
export function moduleSettingsPath(id: string | null): string | null {
  const result = id ? resolveSetting(id, true) : null;
  return result?.kind === 'known' ? result.path : null;
}
