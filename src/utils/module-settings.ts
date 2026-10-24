import { SETTINGS_REGISTRY } from './settings-registry.js';
const sections: Record<string, string> = {
  account: 'account', ai: 'ai', notifications: 'notifications', 'daily-report': 'reports', 'report-email': 'reports', 'report-personalization': 'reports',
  library: 'library', mail: 'reports', caldav: 'integrations', guides: 'integrations', data: 'data', tools: 'advanced', admin: 'advanced', 'advanced-features': 'advanced', 'android-server': 'advanced',
};
export function resolveSetting(id: string, admin = false): { kind: 'known'; path: string } | { kind: 'unknown' | 'forbidden' } {
  if (id === 'setting-daily-report-17lgo36') return {kind:'known',path:'/settings/reports'};
  if (id === 'library-personal-preferences') return { kind: 'known', path: '/settings/account/profile' };
  if (['settings-statistics','statistics-filters'].includes(id)) return {kind:'known',path:'/settings/statistics'};
  if (id === 'statistics-history') return {kind:'known',path:'/settings/statistics/history'};
  const section = id.startsWith('settings-') ? id.slice(9) : id;
  if (sections[section]) return section === 'admin' && !admin ? { kind: 'forbidden' } : { kind: 'known', path: `/settings/${sections[section]}${['daily-report','report-email','mail'].includes(section) ? '/delivery' : ''}` };
  const item = SETTINGS_REGISTRY.find(item => item.id === id);
  if (!item) return { kind: 'unknown' };
  if (item.admin && !admin || /android-(?:fcm|local)-test/.test(id)) return { kind: 'forbidden' };
  const category = id === 'setting-notifications-1ov9hhr' ? 'reports' : sections[item.section];
  return category ? { kind: 'known', path: `/settings/${category}${category === 'reports' && item.section !== 'report-personalization' ? '/delivery' : ''}` } : { kind: 'unknown' };
}
/** Mapping is metadata only; callers must still check role with resolveSetting. */
export function moduleSettingsPath(id: string | null): string | null {
  const result = id ? resolveSetting(id, true) : null;
  return result?.kind === 'known' ? result.path : null;
}
