import { SETTINGS_REGISTRY } from './settings-registry.js';
import { moduleSettingsPath } from './module-settings.js';

export type NavigationTarget = 'settings.dailyReport' | 'settings.knowledge' | 'settings.notifications' | 'settings.profile' | 'settings.general';
export interface NavigationAction { type: 'navigate'; target: NavigationTarget; settingId: string; label: string }
const moduleIds: Record<string, string> = {
  'settings.dailyReport': 'settings-daily-report', 'settings.knowledge': 'settings-library',
  'settings.notifications': 'setting-notifications-1q1t6v5', 'settings.profile': 'library-personal-preferences',
};
export function settingAction(id: string, admin = false): NavigationAction | null {
  const definition = SETTINGS_REGISTRY.find(item => item.id === id);
  const module = Object.entries(moduleIds).find(([, value]) => value === id);
  if ((!definition && !module) || definition?.admin && !admin || /(?:android-fcm-test|android-local-test)/.test(id)) return null;
  const path = moduleSettingsPath(id);
  const target: NavigationTarget = path === '/reports/settings' ? 'settings.dailyReport' : path === '/library/settings' ? 'settings.knowledge'
    : path === '/settings/profile' ? 'settings.profile' : definition?.section === 'notifications' ? 'settings.notifications' : 'settings.general';
  const label = target === 'settings.dailyReport' ? '打开日报设置' : target === 'settings.knowledge' ? '打开知识库设置'
    : target === 'settings.profile' ? '打开个人资料' : target === 'settings.notifications' ? '打开通知设置' : `打开${definition!.label}`;
  return { type: 'navigate', target, settingId: id, label };
}
export function navigationHref(value: unknown, admin = false): string | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as NavigationAction;
  const known = settingAction(action.settingId, admin);
  if (action.type !== 'navigate' || !known || action.target !== known.target) return null;
  return `${moduleSettingsPath(known.settingId) || '/assistant'}?settings=${encodeURIComponent(known.settingId)}`;
}
export function settingsActions(query: string, admin = false): NavigationAction[] {
  if (/日报/.test(query) && /关注|行业|偏好|设置|配置/.test(query)) return [settingAction('setting-daily-report-17lgo36', admin)!];
  if (/知识库/.test(query) && /设置|配置|接入|令牌/.test(query)) return [settingAction('settings-library', admin)!];
  if (/通知|提醒/.test(query) && /设置|配置|权限/.test(query)) return [settingAction('setting-notifications-1q1t6v5', admin)!];
  if (/个人资料|个人信息/.test(query)) return [settingAction('library-personal-preferences', admin)!];
  return [];
}
