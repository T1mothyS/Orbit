import { BookOpen,Bot,CalendarDays,CircleArrowRight,Newspaper,Repeat2,type LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import '../styles/account-menu.css';
import { NavigationItem,ToastProvider,TooltipProvider } from '../ui';
import { AccountMenu } from './AccountMenu';
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
  return (
    <TooltipProvider><ToastProvider><div className={`oui-root app-shell${mobileReader ? ' app-shell-mobile-reader' : ''}`}>
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
          <AccountMenu theme={theme} onToggleTheme={onToggleTheme} onOpenSettings={onOpenSettings} onOpenAdmin={onOpenAdmin} user={user} onLogout={onLogout}/>
        </div>
      </header>
      <BrowserNotifications/><AndroidNotifications/><main className="app-shell-body">{children}</main>
    </div></ToastProvider></TooltipProvider>
  );
}
