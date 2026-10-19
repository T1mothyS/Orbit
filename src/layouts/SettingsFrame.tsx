import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { HelpPopover, IconButton, TextLink } from '../ui';
import { ReturnToToday } from '../components/ReturnToToday';
import type { SettingsCategory } from '../features/settings/navigation';
import './settings-frame.css';

export const SettingsHeadingHelp = createContext<(help: ReactNode) => void>(() => {});

export function SettingsFrame({ category, title, description, navigation, children, search, accountMenu }: { category?: string; title: string; description?: string; navigation: SettingsCategory[]; children: ReactNode; search?: ReactNode; accountMenu?: ReactNode; fallbackReturnTo?: string }) {
  const location = useLocation(), heading = useRef<HTMLHeadingElement>(null);
  const [sectionHelp, setSectionHelp] = useState<ReactNode>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => { if (category) setExpanded(current => ({ ...current, [category]: true })); }, [category, location.pathname]);
  const navigationState = location.state;
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
      </div>
      {search}
      <div className="settings-workspace-actions">{accountMenu}</div>
    </header>
    <div className="settings-workspace-layout"><aside className="settings-workspace-sidebar"><Link to="/settings" state={navigationState} className="settings-workspace-nav-title">设置</Link>
      <nav aria-label="设置分类">{navigation.map(item => <div key={item.id} className="settings-nav-group">
        <div className="settings-nav-parent"><Link to={item.to} state={navigationState} data-current={category === item.id || undefined} aria-current={!item.children && category === item.id ? 'page' : undefined}>{item.title}</Link>{item.children && <IconButton variant="quiet" label={`${expanded[item.id] ? '收起' : '展开'}${item.title}`} aria-expanded={!!expanded[item.id]} aria-controls={`settings-children-${item.id}`} onClick={() => setExpanded(current => ({ ...current, [item.id]: !current[item.id] }))}><ChevronDown size={14} className={expanded[item.id] ? 'is-expanded' : ''} /></IconButton>}</div>
        {item.children && <div id={`settings-children-${item.id}`} hidden={!expanded[item.id]} className="settings-nav-children">{item.children.map(child => <Link key={child.id} to={child.to} state={navigationState} aria-current={location.pathname === child.to ? 'page' : undefined}>{child.title}</Link>)}</div>}
      </div>)}</nav>
    </aside><main className="settings-workspace-main"><div className="settings-content-navigation"><ReturnToToday/>
      {category && <div className="settings-workspace-mobile-back"><TextLink to="/settings" state={navigationState}>设置</TextLink></div>}</div>
      <header className="settings-workspace-heading"><div className="settings-heading-with-help"><h1 tabIndex={-1} ref={heading}>{title}</h1>{(description || sectionHelp) && <HelpPopover label={title}>{description && <p>{description}</p>}{sectionHelp}</HelpPopover>}</div></header>
      <SettingsHeadingHelp.Provider value={setSectionHelp}>{children}</SettingsHeadingHelp.Provider>
    </main></div>
  </div>;
}
