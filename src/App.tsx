import { CalendarDays } from 'lucide-react';
import { lazy, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ActionCenterPage } from './components/ActionCenterPage';
import { AppShell } from './components/AppShell';
import { FeatureBoundary } from './components/FeatureBoundary';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { LoginPage } from './pages/LoginPage';
import { moduleSettingsPath } from './utils/module-settings';

const SettingsDialog = lazy(() => import('./components/settings/SettingsDialog').then(module => ({ default: module.SettingsDialog })));
const ModuleSettingsPage = lazy(() => import('./components/settings/ModuleSettingsPage').then(module => ({ default: module.ModuleSettingsPage })));
const AdminModal = lazy(() => import('./components/AdminModal').then(module => ({ default: module.AdminModal })));
const SchedulePage = lazy(() => import('./pages/SchedulePage').then(module => ({ default: module.SchedulePage })));
const AiAssistantPage = lazy(() => import('./pages/AiAssistantPage').then(module => ({ default: module.AiAssistantPage })));
const ReminderPage = lazy(() => import('./components/ReminderPage').then(module => ({ default: module.ReminderPage })));
const DailyReportsPage = lazy(() => import('./components/DailyReportsPage').then(module => ({ default: module.DailyReportsPage })));
const DailyReportReaderPage = lazy(() => import('./components/DailyReportsPage').then(module => ({ default: module.DailyReportReaderPage })));
const ResearchPage = lazy(() => import('./components/ResearchPage').then(module => ({ default: module.ResearchPage })));
const LibraryPage = lazy(() => import('./components/LibraryPage').then(module => ({ default: module.LibraryPage })));
const ToolsPage = lazy(() => import('./pages/ToolsPage').then(module => ({ default: module.ToolsPage })));
const ProjectEvolutionPage = lazy(() => import('./pages/ProjectEvolutionPage').then(module => ({ default: module.ProjectEvolutionPage })));

function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // 动态更新 Tab 标题
  useEffect(() => {
    if (isLoading) {
      document.title = 'Orbit - Loading...';
      return;
    }

    if (!isAuthenticated) {
      document.title = 'Orbit - 登录 / Login';
    } else {
      // 检查是否打开了设置弹窗
      const settingsDialog = document.querySelector('.settings-dialog-content');
      if (settingsDialog) {
        document.title = 'Orbit - 设置 / Settings';
      } else {
        const moduleTitle = location.pathname === '/settings/profile' ? '个人资料' : location.pathname === '/reports/settings' ? '日报设置' : location.pathname === '/library/settings' ? '知识库设置' : null;
        document.title = moduleTitle ? `Orbit - ${moduleTitle}` : /^\/project\/?$/.test(location.pathname)
          ? (new URLSearchParams(location.search).get('view')==='statistics'?'Orbit - 个人活动报告':'Orbit - 项目成长')
          : location.pathname.startsWith('/library/experience') ? 'Orbit - 记录经历' : /^\/tools\/?$/.test(location.pathname) ? 'Orbit - Tools' : /^\/assistant\/?$/.test(location.pathname)?'Orbit - 对话':'Orbit - 首页 / Home';
      }
    }
  }, [isAuthenticated, isLoading, location.pathname,location.search]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
        <div className="text-center">
          <CalendarDays size={38} className="mx-auto mb-3" aria-hidden="true" />
          <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {!isAuthenticated ? (
        <>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<LoginPage />} />
        </>
      ) : (
        <>
          <Route path="/today" element={<AppContent />} />
          <Route path="/schedule" element={<AppContent />} />
          <Route path="/assistant" element={<AppContent />} />
          <Route path="/reminders" element={<AppContent />} />
          <Route path="/import" element={<Navigate to="/assistant?tool=email-import" replace />} />
          <Route path="/reports" element={<AppContent />} />
          <Route path="/reports/settings" element={<AppContent />} />
          <Route path="/settings/profile" element={<AppContent />} />
          <Route path="/research" element={<AppContent />} />
          <Route path="/reports/:date" element={<FeatureBoundary key={location.pathname}><DailyReportReaderPage /></FeatureBoundary>} />
          <Route path="/library" element={<AppContent />} />
          <Route path="/library/preferences" element={<LegacyPreferencesRedirect />} />
          <Route path="/library/settings" element={<AppContent />} />
          <Route path="/library/experience" element={<AppContent />} />
          <Route path="/library/experience/:sessionId" element={<AppContent />} />
          <Route path="/library/:id" element={<AppContent />} />
          <Route path="/tools" element={<AppContent />} />
          <Route path="/project" element={<AppContent />} />
          <Route path="*" element={<Navigate to="/assistant" replace />} />
        </>
      )}
    </Routes>
  );
}

function LegacyPreferencesRedirect() {
  const location = useLocation();
  const path = moduleSettingsPath(new URLSearchParams(location.search).get('settings')) || '/reports/settings';
  return <Navigate to={`${path}${location.search}`} replace />;
}

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const settingsTriggerRef = useRef<HTMLElement | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isToolsPage = location.pathname === '/tools' || location.pathname === '/tools/';
  const isProjectPage = location.pathname === '/project' || location.pathname === '/project/';
  const isResearchPage = location.pathname === '/research' || location.pathname === '/research/';
  const settingsModule = location.pathname === '/settings/profile' ? 'profile' : location.pathname === '/reports/settings' ? 'reports' : location.pathname === '/library/settings' ? 'library' : null;
  const isLibraryReader = /^\/library\/[^/]+\/?$/.test(location.pathname) && !settingsModule && location.pathname !== '/library/experience';
  const activeSection: 'today' | 'schedule' | 'assistant' | 'reminders' | 'reports' | 'library' | null = isToolsPage || isProjectPage || settingsModule === 'profile' ? null : isResearchPage || location.pathname.startsWith('/reports') ? 'reports' : location.pathname.startsWith('/library') ? 'library' : location.pathname === '/schedule' ? 'schedule' : location.pathname === '/assistant' ? 'assistant' : location.pathname === '/reminders' ? 'reminders' : 'today';
  const changeSection = (section: 'today' | 'schedule' | 'assistant' | 'reminders' | 'reports' | 'library') => navigate(section === 'schedule' ? '/schedule' : section === 'assistant' ? '/assistant' : section === 'reminders' ? '/reminders' : section === 'reports' ? '/reports' : section === 'library' ? '/library' : '/today');

  const settingsId=new URLSearchParams(location.search).get('settings');
  const settingsLocation = useRef({ pathname: location.pathname, id: settingsId });
  useEffect(() => {
    if (settingsLocation.current.pathname !== location.pathname || settingsLocation.current.id !== settingsId) setShowSettings(false);
    settingsLocation.current = { pathname: location.pathname, id: settingsId };
    if (!settingsId) return;
    const destination = moduleSettingsPath(settingsId);
    if (destination && destination !== location.pathname) navigate(`${destination}${location.search}`, { replace: true });
    else if (!settingsModule) setShowSettings(true);
  }, [settingsId, settingsModule, location.pathname, location.search, navigate]);
  useEffect(()=>{const open=(event:Event)=>{settingsTriggerRef.current=document.activeElement as HTMLElement;setShowSettings(true);const section=(event as CustomEvent<string>).detail;if(section)setTimeout(()=>document.dispatchEvent(new CustomEvent('orbit:settings-open-section',{detail:section})),200);};window.addEventListener('orbit:open-settings',open);return()=>window.removeEventListener('orbit:open-settings',open);},[]);
  const closeSettings=()=>{setShowSettings(false);if(settingsId){const params=new URLSearchParams(location.search);params.delete('settings');navigate({pathname:location.pathname,search:params.toString()},{replace:true});}};
  // 设置弹窗打开/关闭时更新 Tab 标题
  useEffect(() => {
    document.title = showSettings
      ? 'Orbit - 设置 / Settings'
      : showAdmin
      ? 'Orbit - 管理面板 / Admin'
      : settingsModule
      ? `Orbit - ${settingsModule === 'profile' ? '个人资料' : settingsModule === 'reports' ? '日报设置' : '知识库设置'}`
      : activeSection === null
      ? isProjectPage ? (new URLSearchParams(location.search).get('view')==='statistics'?'Orbit - 个人活动报告':'Orbit - 项目成长') : 'Orbit - Tools'
      : location.pathname.startsWith('/library/experience') ? 'Orbit - 记录经历' : /^\/library\/preferences\/?$/.test(location.pathname) ? 'Orbit - 个人资料与日报偏好' : activeSection === 'assistant' ? 'Orbit - 对话' : 'Orbit - 个人事务中心';
  }, [activeSection, showSettings, showAdmin, isProjectPage,location.search,location.pathname]);

  return (
    <>
      <AppShell
        mobileReader={isLibraryReader}
        activeSection={activeSection}
        onSectionChange={changeSection}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => { settingsTriggerRef.current = document.activeElement as HTMLElement; setShowSettings(true); }}
        onOpenAdmin={() => setShowAdmin(true)}
        user={user}
        onLogout={logout}
      >
        <FeatureBoundary key={settingsModule ? location.pathname : activeSection === 'library' ? location.pathname : activeSection ?? (isProjectPage ? 'project' : 'tools')} navigation={isLibraryReader ? <Link className="feature-reader-back" to="/library" aria-label="返回知识库">←</Link> : undefined}>
        {settingsModule ? <ModuleSettingsPage module={settingsModule} /> : isProjectPage ? <ProjectEvolutionPage /> : activeSection === null ? <ToolsPage /> : activeSection === 'today' ? <ActionCenterPage /> : activeSection === 'schedule' ? (
          <SchedulePage user={user} />
        ) : activeSection === 'assistant' ? <AiAssistantPage /> : activeSection === 'reminders' ? (
          <ReminderPage />
        ) : isResearchPage ? <ResearchPage /> : activeSection === 'reports' ? <DailyReportsPage /> : activeSection === 'library' ? <LibraryPage /> : <ActionCenterPage />}
        </FeatureBoundary>
      </AppShell>

      {showSettings && <FeatureBoundary onClose={() => { closeSettings(); settingsTriggerRef.current?.focus(); }}><SettingsDialog
        restoreFocusTo={settingsTriggerRef.current}
        onClose={closeSettings}
        onOpenAdmin={() => { setShowSettings(false); setShowAdmin(true); }}
        onOpenTools={() => { setShowSettings(false); navigate('/tools'); }}
      /></FeatureBoundary>}

      {/* 管理员弹层 */}
      {showAdmin && (
        <FeatureBoundary onClose={() => setShowAdmin(false)}>
        <AdminModal
          visible={showAdmin}
          onClose={() => setShowAdmin(false)}
        />
        </FeatureBoundary>
      )}
    </>
  );
}

export default App;
