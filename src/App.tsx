import { CalendarDays } from 'lucide-react';
import { lazy,useEffect,useRef,useState } from 'react';
import { Link,Navigate,Route,Routes,useLocation,useNavigate } from 'react-router-dom';
import { ActionCenterPage } from './components/ActionCenterPage';
import { AppShell } from './components/AppShell';
import { FeatureBoundary } from './components/FeatureBoundary';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { LoginPage } from './pages/LoginPage';
import { moduleSettingsPath } from './utils/module-settings';

const AdminModal = lazy(() => import('./components/AdminModal').then(module => ({ default: module.AdminModal })));
const SchedulePage = lazy(() => import('./pages/SchedulePage').then(module => ({ default: module.SchedulePage })));
const ImportPage = lazy(() => import('./pages/ImportPage').then(module => ({ default: module.ImportPage })));
const AiAssistantPage = lazy(() => import('./pages/AiAssistantPage').then(module => ({ default: module.AiAssistantPage })));
const ReminderPage = lazy(() => import('./components/ReminderPage').then(module => ({ default: module.ReminderPage })));
const DailyReportsPage = lazy(() => import('./components/DailyReportsPage').then(module => ({ default: module.DailyReportsPage })));
const DailyReportReaderPage = lazy(() => import('./components/DailyReportsPage').then(module => ({ default: module.DailyReportReaderPage })));
const ResearchPage = lazy(() => import('./components/ResearchPage').then(module => ({ default: module.ResearchPage })));
const LibraryPage = lazy(() => import('./components/LibraryPage').then(module => ({ default: module.LibraryPage })));
const ToolsPage = lazy(() => import('./pages/ToolsPage').then(module => ({ default: module.ToolsPage })));
const ProjectEvolutionPage = lazy(() => import('./pages/ProjectEvolutionPage').then(module => ({ default: module.ProjectEvolutionPage })));
const HelpPage = lazy(() => import('./features/help/HelpPage'));
const SettingsWorkspace = lazy(() => import('./features/settings/SettingsWorkspace'));
const SettingsRedirect = lazy(() => import('./features/settings/SettingsRedirect'));

function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation(), navigate = useNavigate();
  const settingsOrigin = useRef('/assistant');
  if (!location.pathname.startsWith('/settings') && !['/reports/settings','/library/settings','/library/preferences'].includes(location.pathname) && !new URLSearchParams(location.search).has('settings')) settingsOrigin.current = location.pathname + location.search;
  useEffect(() => { const open = (event: Event) => { const detail = (event as CustomEvent<string>).detail; const id = detail ? (detail.startsWith('settings-') || moduleSettingsPath(detail) ? detail : 'settings-' + detail) : ''; navigate((moduleSettingsPath(id) || '/settings') + (id ? '?settings=' + encodeURIComponent(id) : ''), {state: {settingsReturnTo: location.pathname + location.search}}); }; window.addEventListener('orbit:open-settings',open); return () => window.removeEventListener('orbit:open-settings',open); }, [navigate,location.pathname,location.search]);

  // 动态更新 Tab 标题
  useEffect(() => {
    if (isLoading) {
      document.title = 'Orbit - Loading...';
      return;
    }

    if (!isAuthenticated) {
      document.title = 'Orbit - 登录 / Login';
    } else {
      const titles:Record<string,string>={'/settings':'设置','/settings/account':'账户与安全','/settings/account/profile':'个人资料','/settings/notifications':'通知与提醒','/settings/ai':'AI 与模型','/settings/reports':'日报','/settings/library':'知识库','/settings/integrations':'同步与集成','/settings/data':'数据与备份','/settings/advanced':'高级','/help':'使用指南','/import':'邮箱导入'};
      document.title='Orbit - '+(titles[location.pathname]||(location.pathname.startsWith('/reports')?'日报':location.pathname.startsWith('/library')?'知识库':location.pathname==='/assistant'?'对话':location.pathname==='/project'?'项目成长':'个人事务中心'));
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

  if (isAuthenticated && new URLSearchParams(location.search).has('settings') && !location.pathname.startsWith('/settings') && !['/reports/settings','/library/settings','/library/preferences'].includes(location.pathname)) return <FeatureBoundary><SettingsRedirect /></FeatureBoundary>;

  if (isAuthenticated && location.pathname === '/assistant' && new URLSearchParams(location.search).get('tool') === 'email-import') { const next = new URLSearchParams(location.search); next.delete('tool'); return <Navigate to={'/import' + (next.size ? '?' + next : '')} replace state={{ ...location.state, importReturnTo: '/assistant' + (next.size ? '?' + next : '') }} />; }

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
          <Route path="/import" element={<AppContent />} />
          <Route path="/reports" element={<AppContent />} />
          <Route path="/reports/settings" element={<FeatureBoundary><SettingsRedirect target="/settings/reports" /></FeatureBoundary>} />
          <Route path="/settings/*" element={<FeatureBoundary><SettingsWorkspace returnTo={settingsOrigin.current} /></FeatureBoundary>} />
          <Route path="/research" element={<AppContent />} />
          <Route path="/reports/:date" element={<FeatureBoundary key={location.pathname}><DailyReportReaderPage /></FeatureBoundary>} />
          <Route path="/library" element={<AppContent />} />
          <Route path="/library/preferences" element={<LegacyPreferencesRedirect />} />
          <Route path="/library/settings" element={<FeatureBoundary><SettingsRedirect target="/settings/library" /></FeatureBoundary>} />
          <Route path="/library/experience" element={<AppContent />} />
          <Route path="/library/experience/:sessionId" element={<AppContent />} />
          <Route path="/library/:id" element={<AppContent />} />
          <Route path="/tools" element={<AppContent />} />
          <Route path="/help" element={<AppContent />} />
          <Route path="/project" element={<AppContent />} />
          <Route path="*" element={<Navigate to="/assistant" replace />} />
        </>
      )}
    </Routes>
  );
}

function LegacyPreferencesRedirect() {
  return <FeatureBoundary><SettingsRedirect target="/settings/reports" /></FeatureBoundary>;
}

function AppContent() {
  const {theme,toggleTheme}=useTheme(), {user,logout}=useAuth(), location=useLocation(), navigate=useNavigate();
  const [showAdmin,setShowAdmin]=useState(false);
  const isImportPage=location.pathname==='/import';
  const isHelpPage=location.pathname==='/help', isToolsPage=location.pathname==='/tools', isProjectPage=location.pathname==='/project', isResearchPage=location.pathname==='/research';
  const isLibraryReader=/^\/library\/[^/]+\/?$/.test(location.pathname)&&location.pathname!=='/library/experience';
  const activeSection: 'today'|'schedule'|'assistant'|'reminders'|'reports'|'library'|null=isHelpPage||isToolsPage||isProjectPage||isImportPage?null:isResearchPage||location.pathname.startsWith('/reports')?'reports':location.pathname.startsWith('/library')?'library':location.pathname==='/schedule'?'schedule':location.pathname==='/assistant'?'assistant':location.pathname==='/reminders'?'reminders':'today';
  useEffect(()=>{if(!(location.state as {settingsFocusReturn?:boolean}|null)?.settingsFocusReturn)return;const frame=requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-account-menu-trigger]')?.focus());return()=>cancelAnimationFrame(frame);},[location.key,location.state]);
  return <><AppShell mobileReader={isLibraryReader} activeSection={activeSection} onSectionChange={section=>navigate('/'+section)} theme={theme} onToggleTheme={toggleTheme} onOpenSettings={()=>navigate('/settings',{state:{settingsReturnTo:location.pathname+location.search}})} onOpenAdmin={()=>setShowAdmin(true)} user={user} onLogout={logout}>
    <FeatureBoundary key={activeSection==='library'?location.pathname:activeSection||(isHelpPage?'help':isImportPage?'import':isProjectPage?'project':'tools')} navigation={isLibraryReader?<Link className="feature-reader-back" to="/library" aria-label="返回知识库">←</Link>:undefined}>
      {isImportPage?<ImportPage/>:isHelpPage?<HelpPage/>:isProjectPage?<ProjectEvolutionPage/>:activeSection===null?<ToolsPage/>:activeSection==='today'?<ActionCenterPage/>:activeSection==='schedule'?<SchedulePage user={user}/>:activeSection==='assistant'?<AiAssistantPage/>:activeSection==='reminders'?<ReminderPage/>:isResearchPage?<ResearchPage/>:activeSection==='reports'?<DailyReportsPage/>:activeSection==='library'?<LibraryPage/>:<ActionCenterPage/>}
    </FeatureBoundary></AppShell>
    {showAdmin&&<FeatureBoundary onClose={()=>setShowAdmin(false)}><AdminModal visible onClose={()=>setShowAdmin(false)}/></FeatureBoundary>}
  </>;
}

export default App;
