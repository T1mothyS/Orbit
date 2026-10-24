import { lazy,useEffect,useState } from 'react';
import { Navigate,useLocation,useNavigate } from 'react-router-dom';
import { FeatureBoundary } from '../../components/FeatureBoundary';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { AccountMenu } from '../../components/AccountMenu';
import { StatisticsSettings } from './StatisticsSettings';
import { SettingsFrame } from '../../layouts/SettingsFrame';
import { InlineNotice,TextLink,ToastProvider,TooltipProvider,Tabs } from '../../ui';
import { resolveSetting } from '../../utils/module-settings';
import AccountPage from './account/AccountPage';
import { ContextEditor } from './context/ContextEditor';
import { settingsCategories } from './navigation';
import { ReportsPage } from './ReportsPage';
import { AdminSettings } from './sections/AdminSettings';
import { AiSettings } from './sections/AiSettings';
import { CaldavSettings } from './sections/CaldavSettings';
import { DataSettings } from './sections/DataSettings';
import { IntegrationGuideSettings } from './sections/IntegrationGuideSettings';
import { LibraryIntegrationSettings } from './sections/LibraryIntegrationSettings';
import { NotificationSettings } from './sections/NotificationSettings';
import { ToolsSettings } from './sections/ToolsSettings';
import { AdvancedFeaturesSettings } from './sections/AdvancedFeaturesSettings';
import './settings.css';
import { SettingsConfirmProvider } from './SettingsConfirm';
import SettingsHomePage from './SettingsHomePage';
import { SettingsSearch } from './SettingsSearch';
import { SettingsActivity,SettingsStateProvider,useSettingsState } from './SettingsState';

const AdminModal = lazy(() => import('../../components/AdminModal').then(module => ({ default: module.AdminModal })));
export default function SettingsWorkspace({ returnTo }: { returnTo?: string }) {
  const { user } = useAuth();
  return <TooltipProvider><ToastProvider><SettingsStateProvider key={user?.id}><SettingsConfirmProvider><SettingsPages returnTo={returnTo} /></SettingsConfirmProvider></SettingsStateProvider></ToastProvider></TooltipProvider>;
}
function SettingsPages({ returnTo }: { returnTo?: string }) {
  const { user, logout } = useAuth(), { authHeaders } = useSettingsState(), location = useLocation(), navigate = useNavigate();
  const [adminOpen, setAdminOpen] = useState(false), [visited, setVisited] = useState<string[]>([]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const profile = location.pathname === '/settings/account/profile';
  const category = settingsCategories.find(item => location.pathname === item.to || item.children?.some(child => child.to === location.pathname));
  const id = new URLSearchParams(location.search).get('settings'), result = id ? resolveSetting(id, user?.role === 'admin') : null;
  const active = category?.id || '';
  const accountTabs = settingsCategories.find(item => item.id === 'account')!.children!;
  useEffect(() => { if (active) setVisited(current => current.includes(active) ? current : [...current, active]); }, [active]);
  if (location.pathname === '/settings/profile') return <Navigate to={'/settings/account/profile' + location.search} replace state={location.state} />;
  if (result?.kind === 'known' && result.path !== location.pathname) return <Navigate to={result.path + location.search} replace state={location.state} />;
  const pages: Record<string, React.ReactNode> = {
    notifications: <NotificationSettings />,
    ai: <AiSettings authHeaders={authHeaders} isAdmin={user?.role === 'admin'} />,
    reports: <ReportsPage />,
    statistics: <StatisticsSettings />,
    library: <LibraryIntegrationSettings authHeaders={authHeaders} />,
    integrations: <><CaldavSettings authHeaders={authHeaders} /><IntegrationGuideSettings authHeaders={authHeaders} /></>,
    data: <DataSettings authHeaders={authHeaders} />,
    advanced: <><AdvancedFeaturesSettings /><ToolsSettings onOpenTools={() => navigate('/tools')} /><section className="oui-section"><h2>使用与帮助</h2><p className="oui-help">从常用任务开始，了解功能入口和操作边界。</p><TextLink to="/help">打开 Orbit 使用指南</TextLink></section>{user?.role === 'admin' && <AdminSettings onOpenAdmin={() => setAdminOpen(true)} />}</>,
  };
  return <SettingsFrame fallbackReturnTo={returnTo} accountMenu={<AccountMenu theme={theme} onToggleTheme={toggleTheme} user={user} onLogout={logout} onOpenAdmin={() => setAdminOpen(true)} />} navigation={settingsCategories} category={category?.id} title={category?.title || '设置'} description={category?.description || '按需要调整你的 Orbit。'} searchExpanded={searchExpanded} search={<SettingsSearch onExpandedChange={setSearchExpanded} />}>
    {result && result.kind !== 'known' && <InlineNotice tone="warning" title={result.kind === 'forbidden' ? '无权访问此设置项' : '设置项不存在'}>请通过分类或搜索选择可用设置。</InlineNotice>}
    {!category && location.pathname.replace(/\/$/, '') === '/settings' ? <SettingsHomePage /> : !category ? <InlineNotice tone="warning" title="设置分类不存在"><TextLink to="/settings">返回设置</TextLink></InlineNotice> : null}
    {active === 'account' && <Tabs label="账户设置分类" value={profile ? 'profile' : 'account'} onValueChange={value => navigate(accountTabs.find(item => item.id === value)!.to, {state: location.state})} items={accountTabs.map(item => ({value:item.id,label:item.title,content:item.id === 'profile' ? <ContextEditor mode="profile"/> : <AccountPage/>}))} />}
    {[...new Set([...visited, active])].filter(key => pages[key]).map(key => <div key={key} hidden={key !== active}><SettingsActivity active={key === active}><FeatureBoundary>{pages[key]}</FeatureBoundary></SettingsActivity></div>)}
    {adminOpen && <FeatureBoundary onClose={() => setAdminOpen(false)}><AdminModal visible onClose={() => setAdminOpen(false)} /></FeatureBoundary>}
  </SettingsFrame>;
}
