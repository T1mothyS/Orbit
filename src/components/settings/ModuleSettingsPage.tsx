import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { LibraryPreferencesPage } from '../library/LibraryPreferencesPage';
import { SettingsSearchProvider } from './SettingsSearch';
import { SettingRow } from './SettingRow';
import { SettingSection } from './SettingSection';
import { DailyReportSettings } from './sections/DailyReportSettings';
import { LibraryIntegrationSettings } from './sections/LibraryIntegrationSettings';
import { ReportEmailSettings } from './sections/ReportEmailSettings';
import '../library/library.css';
import './settings.css';
import './module-settings.css';

export function ModuleSettingsPage({ module }: { module: 'reports' | 'library' | 'profile' }) {
  const { user, authHeaders } = useAuth();
  return <ModuleSettings key={`${user?.id}:${module}`} module={module} authHeaders={authHeaders} />;
}
function ModuleSettings({ module, authHeaders }: { module: 'reports' | 'library' | 'profile'; authHeaders: () => Record<string, string> }) {
  const [tab, setTab] = useState('personal');
  useEffect(() => {
    const select = (event: Event) => setTab((event as CustomEvent<string>).detail === 'report-personalization' ? 'personal' : 'functional');
    document.addEventListener('orbit:settings-section', select);
    return () => document.removeEventListener('orbit:settings-section', select);
  }, []);
  if (module === 'profile') return <LibraryPreferencesPage mode="profile" />;
  return <main className={`module-settings-page ${module}-settings-page`}>
    <Link className="library-back-button" to={`/${module}`}>← 返回{module === 'reports' ? '日报' : '知识库'}</Link>
    <h1>{module === 'reports' ? '日报设置' : '知识库设置'}</h1>
    <SettingsSearchProvider>
      {module === 'library' ? <LibraryIntegrationSettings authHeaders={authHeaders} /> : <>
        <div className="module-settings-tabs" role="tablist" aria-label="日报设置分类">
          {(['personal', 'functional'] as const).map(value => <button key={value} id={`reports-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls={`reports-${value}-panel`} onClick={() => setTab(value)}>{value === 'personal' ? '个性化' : '功能设置'}</button>)}
        </div>
        <div className="module-settings-columns">
          <div id="reports-personal-panel" role="tabpanel" aria-labelledby="reports-personal-tab" className={`module-settings-panel ${tab === 'personal' ? 'selected' : ''}`}>
            <SettingSection id="report-personalization" title="日报个性化">
              <SettingRow id="setting-daily-report-17lgo36" label="日报个性化"><LibraryPreferencesPage embedded /></SettingRow>
            </SettingSection>
          </div>
          <div id="reports-functional-panel" role="tabpanel" aria-labelledby="reports-functional-tab" className={`module-settings-panel ${tab === 'functional' ? 'selected' : ''}`}>
            <DailyReportSettings authHeaders={authHeaders} showContext={false} />
            <ReportEmailSettings authHeaders={authHeaders} />
          </div>
        </div>
      </>}
    </SettingsSearchProvider>
  </main>;
}
