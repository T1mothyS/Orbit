import { BookOpen,Bot,CalendarDays,ChartNoAxesCombined,CircleArrowRight,Moon,Newspaper,Repeat2,Settings,Sun,UserRound,type LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { APP_CONFIG } from '../config';
import '../styles/account-menu.css';
import { IconButton,Menu,NavigationItem,ToastProvider,type MenuItem } from '../ui';
import { AccountAvatar } from './AccountAvatar';
import { AndroidNotifications } from './AndroidNotifications';
import { BrowserNotifications } from './BrowserNotifications';
import { GlobalSearch } from './GlobalSearch';
import './shell-controls.css';

type Section = 'today' | 'schedule' | 'assistant' | 'reminders' | 'reports' | 'library';

const productNavItems: Array<{ section: Section; label: string; icon?: string; Icon?: LucideIcon }> = [
  { section: 'assistant', label: 'AI 对话', Icon: Bot },

  { section: 'today', label: '今日', Icon: CircleArrowRight },
  { section: 'schedule', label: '日程', Icon: CalendarDays },
  { section: 'reminders', label: '周期提醒', Icon: Repeat2 },
  { section: 'reports', label: '日报', Icon: Newspaper },
  { section: 'library', label: '知识库', Icon: BookOpen },
];

interface AppShellProps {
  mobileReader?: boolean;
  activeSection: Section | null;
  onSectionChange: (section: Section) => void;
  theme: string;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenAdmin?: () => void;
  user?: { email: string; role: 'admin' | 'user' } | null;
  onLogout?: () => void;
  children: ReactNode;
}

export function AppShell({
  mobileReader = false,
  activeSection,
  onSectionChange,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenAdmin,
  user,
  onLogout,
  children,
}: AppShellProps) {
  const navigate=useNavigate(), location=useLocation();
  const go=(to:string)=>()=>navigate(to,{state:{settingsReturnTo:location.pathname+location.search,helpReturnTo:location.pathname+location.search}});
  const items:MenuItem[]=[
    {id:'settings',label:'设置',icon:<Settings size={16}/>,onSelect:onOpenSettings},
    {id:'account',label:'账户与头像',icon:<UserRound size={16}/>,onSelect:go('/settings/account')},
    {id:'profile',label:'个人资料',icon:<UserRound size={16}/>,onSelect:go('/settings/account/profile')},
    {id:'statistics',label:'使用统计',icon:<ChartNoAxesCombined size={16}/>,onSelect:go('/project?view=statistics')},
    {id:'theme',label:'切换主题',icon:theme==='light'?<Moon size={16}/>:<Sun size={16}/>,onSelect:onToggleTheme},
    {id:'import',label:'邮箱导入',separatorBefore:true,onSelect:go('/assistant?tool=email-import')},
    {id:'research',label:'研究与观点',onSelect:go('/research')},{id:'tools',label:'Tools 工具中心',onSelect:go('/tools')},
    {id:'growth',label:'项目成长',onSelect:go('/project?view=growth')},{id:'help',label:'使用指南',onSelect:go('/help')},
    ...(user?.role==='admin'?[{id:'admin',label:'管理面板',onSelect:()=>onOpenAdmin?.()}]:[]),
    {id:'logout',label:'退出登录',danger:true,separatorBefore:true,onSelect:()=>{onLogout?.();navigate('/login',{replace:true});}},
  ];
  return (
    <ToastProvider><div className={`oui-root app-shell${mobileReader ? ' app-shell-mobile-reader' : ''}`}>
      <header className="reminder-topbar app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><img src="/orbit-logo.png" alt="" aria-hidden="true" /></div>
          <div>
            <div className="brand-name">Orbit</div>
            <div className="brand-subtitle">个人事务中心</div>
          </div>
        </div>

        <nav className="orbit-product-nav" aria-label="产品导航">{productNavItems.map(item=><NavigationItem key={item.section} label={item.label} icon={item.Icon?<item.Icon size={24} strokeWidth={1.8} aria-hidden="true"/>:null} current={activeSection===item.section} onSelect={()=>onSectionChange(item.section)}/>)}</nav>

        <div className="topbar-actions">
          <GlobalSearch />
          <Menu label="个人菜单" trigger={<IconButton label="个人菜单" variant="quiet" data-account-menu-trigger title={user?.email}><AccountAvatar email={user?.email||'O'}/></IconButton>} header={<strong>{user?.email}</strong>} footer={'Orbit '+APP_CONFIG.version} items={items}/>
        </div>
      </header>
      <BrowserNotifications/><AndroidNotifications/><main className="app-shell-body">{children}</main>
    </div></ToastProvider>
  );
}
