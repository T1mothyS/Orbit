import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { IconButton, TextLink, ToastProvider } from '../ui';
import './settings-frame.css';

export function SettingsFrame({ category, title, description, navigation, children }: { category?: string; title: string; description?: string; navigation: { id: string; title: string; to: string }[]; children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation(), heading = useRef<HTMLHeadingElement>(null);
  const requested = (location.state as { settingsReturnTo?: unknown } | null)?.settingsReturnTo;
  let returnTo = '/assistant';
  if (typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')) {
    try {
    const candidate = new URL(requested, window.location.origin);
    if (candidate.origin === window.location.origin) returnTo = candidate.pathname + candidate.search;
    } catch { /* Invalid return locations use the application home. */ }
  }
  const navigationState = { settingsReturnTo: returnTo };
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('settings');
    const target = id && document.getElementById(id);
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'center' }); }
    else heading.current?.focus({ preventScroll: true });
  }, [location.pathname, location.search]);
  return <ToastProvider><div className="oui-root settings-workspace">
    <header className="settings-workspace-topbar"><Link to="/assistant" className="settings-workspace-brand" aria-label="Orbit 首页"><img src="/orbit-logo.png" alt="" /><strong>Orbit</strong></Link>
      <div className="settings-workspace-actions"><TextLink to={returnTo} state={{ settingsFocusReturn: true }}>返回 Orbit</TextLink><IconButton label="切换主题" variant="quiet" onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</IconButton></div>
    </header>
    <div className="settings-workspace-layout"><aside className="settings-workspace-sidebar"><Link to="/settings" state={navigationState} className="settings-workspace-nav-title">设置</Link>
      <nav aria-label="设置分类">{navigation.map(item => <Link key={item.id} to={item.to} state={navigationState} aria-current={category === item.id ? 'page' : undefined}>{item.title}</Link>)}</nav>
    </aside><main className="settings-workspace-main">
      {category && <div className="settings-workspace-mobile-back"><TextLink to="/settings" state={navigationState}><ArrowLeft size={16} aria-hidden="true" />设置</TextLink></div>}
      <header className="settings-workspace-heading"><h1 tabIndex={-1} ref={heading}>{title}</h1>{description && <p>{description}</p>}</header>
      {children}
    </main></div>
  </div></ToastProvider>;
}
