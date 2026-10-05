import { ReactNode, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AccountAvatar } from './AccountAvatar';
import { BrowserNotifications } from './BrowserNotifications';
import '../styles/account-menu.css';
import { Bot, CalendarDays, CircleArrowRight, Repeat2, BookOpen, Moon, Newspaper, Settings, Sun, UserRound, ChartNoAxesCombined, type LucideIcon } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { GlobalSearch } from './GlobalSearch';

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
  const menu=useRef<HTMLDetailsElement>(null);
  const close=()=>{if(menu.current)menu.current.open=false;};
  useEffect(() => { const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close(); }; window.addEventListener('pointerdown', outside); return () => window.removeEventListener('pointerdown', outside); }, []);
  return (
    <div className={`app-shell${mobileReader ? ' app-shell-mobile-reader' : ''}`}>
      <header className="reminder-topbar app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><img src="/orbit-logo.png" alt="" aria-hidden="true" /></div>
          <div>
            <div className="brand-name">Orbit</div>
            <div className="brand-subtitle">个人事务中心</div>
          </div>
        </div>

        <nav className="product-nav" aria-label="产品导航">
          {productNavItems.map(item => (
            <button
              key={item.section}
              className={`product-nav-item icon-only${activeSection === item.section ? ' active' : ''}`}
              onClick={() => onSectionChange(item.section)}
              title={item.label}
              aria-label={item.label}
              aria-current={activeSection === item.section ? 'page' : undefined}
            >
              {item.icon ? <img className="product-nav-image" src={item.icon} alt="" aria-hidden="true" /> : item.Icon ? <item.Icon className="product-nav-lucide" size={26} strokeWidth={1.8} aria-hidden="true" /> : null}
              <span className="product-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <GlobalSearch />
          <details className="account-menu" ref={menu} onKeyDown={e=>{if(e.key==='Escape'){close();menu.current?.querySelector('summary')?.focus();}}} onBlur={e=>{
            const nextTarget=e.relatedTarget;
            // Non-focusable menu text yields null. Collapsing details during that focus change hangs Chromium.
            // Outside pointer clicks already close the menu; blur only handles an explicit outside focus target.
            if(nextTarget instanceof Node&&!e.currentTarget.contains(nextTarget))close();
          }}>
            <summary aria-label="个人菜单" title={user?.email}><AccountAvatar email={user?.email||'O'}/></summary>
            <div className="account-menu-panel"><strong>{user?.email}</strong>
              <button type="button" onClick={()=>{close();onOpenSettings();}}><Settings size={16}/> 设置</button>
              <button type="button" onClick={()=>{close();window.dispatchEvent(new CustomEvent('orbit:open-settings',{detail:'account'}));}}><UserRound size={16} />账户与头像</button>
              <Link to="/project?view=statistics" onClick={close}><ChartNoAxesCombined size={16} />使用统计</Link>
              <button type="button" onClick={()=>{close();onToggleTheme();}}>{theme==='light'?<Moon size={16}/>:<Sun size={16}/>} 切换主题</button>
              <hr />
              <Link to="/assistant?tool=email-import" onClick={close}>邮箱导入</Link><Link to="/research" onClick={close}>研究与观点</Link>
              <Link to="/tools" onClick={close}>Tools 工具中心</Link><Link to="/project?view=growth" onClick={close}>项目成长</Link>
              {user?.role==='admin'&&<button type="button" onClick={()=>{close();onOpenAdmin?.();}}>管理面板</button>}
              <hr />
              <button type="button" onClick={()=>{onLogout?.();window.location.href='/login';}}>退出登录</button>
              <div className="account-menu-version">Orbit {APP_CONFIG.version}</div>
            </div>
          </details>
        </div>
      </header>
      <BrowserNotifications/><main className="app-shell-body">{children}</main>
    </div>
  );
}
