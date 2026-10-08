/** Stable setting IDs remain valid after moving module settings. */
export function moduleSettingsPath(id: string | null): string | null {
  if (id === 'library-personal-preferences') return '/settings/profile';
  if (id?.startsWith('library-') || id?.startsWith('setting-library-') || id === 'settings-library') return '/library/settings';
  if (id?.startsWith('setting-daily-report-') || id === 'settings-daily-report' || id === 'setting-notifications-1ov9hhr') return '/reports/settings';
  return null;
}
