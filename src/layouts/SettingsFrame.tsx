import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { IconButton, IconLink, TextLink } from '../ui';
import './settings-frame.css';

export function SettingsFrame({ category, title, description, navigation, children, search, fallbackReturnTo }: { category?: string; title: string; description?: string; navigation: { id: string; title: string; to: string }[]; children: ReactNode; search?: ReactNode; fallbackReturnTo?: string }) {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation(), heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<string>();
  const requested = (location.state as { settingsReturnTo?: unknown } | null)?.settingsReturnTo || (!origin.current ? fallbackReturnTo : undefined);
  let returnTo = origin.current || '/assistant';
  if (typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')) {
    try {
    const candidate = new URL(requested, window.location.origin);
    if (candidate.origin === window.location.origin && !candidate.pathname.startsWith('/settings')) { returnTo = candidate.pathname + candidate.search; origin.current = returnTo; }
    } catch { /* Invalid return locations use the application home. */ }
  }
  const navigationState = { settingsReturnTo: returnTo };
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('settings');
    heading.current?.focus({ preventScroll: true });
    if (!id) return;
    const locate = () => {
      const target = document.getElementById(id);
      if (!target?.getClientRects().length) return false;
      target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'center' }); return true;
    };
    if (locate()) return;
    const observer = new MutationObserver(() => { if (locate()) observer.disconnect(); });
    observer.observe(document.querySelector('.settings-workspace-main')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'data-state'] });
    const timer = setTimeout(() => observer.disconnect(), 3000);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [location.pathname, location.search]);
  return <div className="oui-root settings-workspace">
    <header className="settings-workspace-topbar"><div className="settings-workspace-start"><Link to="/assistant" className="settings-workspace-brand" aria-label="Orbit 首页"><img src="/orbit-logo.png" alt="" /><strong>Orbit</strong></Link>
      <IconLink to={returnTo} state={{ settingsFocusReturn: true }} label="返回 Orbit"><ArrowLeft size={18} aria-hidden="true" /></IconLink></div>
      {search}
      <div className="settings-workspace-actions"><IconButton label="切换主题" variant="quiet" onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</IconButton></div>
    </header>
    <div className="settings-workspace-layout"><aside className="settings-workspace-sidebar"><Link to="/settings" state={navigationState} className="settings-workspace-nav-title">设置</Link>
      <nav aria-label="设置分类">{navigation.map(item => <Link key={item.id} to={item.to} state={navigationState} aria-current={category === item.id ? 'page' : undefined}>{item.title}</Link>)}</nav>
    </aside><main className="settings-workspace-main">
      {category && <div className="settings-workspace-mobile-back"><TextLink to="/settings" state={navigationState}><ArrowLeft size={16} aria-hidden="true" />设置</TextLink></div>}
      <header className="settings-workspace-heading"><h1 tabIndex={-1} ref={heading}>{title}</h1>{description && <p>{description}</p>}</header>
      {children}
    </main></div>
  </div>;
}
