import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLocation,useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Button,IconButton,Input } from '../../ui';
import { moduleSettingsPath } from '../../utils/module-settings';
import { findSettings } from '../../utils/settings-registry';
export function SettingsSearch({ onExpandedChange }: { onExpandedChange?: (expanded: boolean) => void }) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [selected, setSelected] = useState(0);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches), [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate();
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => { setMobile(media.matches); setExpanded(false); setOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (mobile && expanded) input.current?.focus(); }, [mobile, expanded]);
  useEffect(() => { onExpandedChange?.(mobile && expanded); }, [mobile, expanded, onExpandedChange]);
  const results = findSettings(query, user?.role === 'admin').slice(0, 12);
  const choose = (id: string) => { setQuery(''); setOpen(false); setExpanded(false); navigate(`${moduleSettingsPath(id)}?settings=${encodeURIComponent(id)}`, { state: location.state }); };
  return <div className="settings-search" data-expanded={mobile && expanded || undefined} data-settings-search-open={open && !!query} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setOpen(false); setExpanded(false); } }}>
    {(!mobile || expanded) && <div className="settings-search-field" id="settings-header-search-field">
    <Input ref={input} id="orbit-settings-search" role="combobox" aria-label="搜索设置" aria-autocomplete="list" aria-expanded={open && !!query} aria-controls={open && query ? 'orbit-settings-search-results' : undefined} aria-activedescendant={open && query && results[selected] ? `setting-result-${results[selected].id}` : undefined} placeholder="搜索设置" autoComplete="off" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setSelected(0); setOpen(true); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); if (mobile) { setExpanded(false); trigger.current?.focus(); } }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setSelected(value => Math.max(0, Math.min(results.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && open && query && results[selected]) { event.preventDefault(); choose(results[selected].id); }
    }} />
    {open && query && <div className="settings-search-results" id="orbit-settings-search-results" role="listbox" aria-label="设置搜索结果">{results.length ? results.map((item, index) => <Button key={item.id} variant="quiet" id={`setting-result-${item.id}`} role="option" aria-selected={index === selected} onMouseDown={event => event.preventDefault()} onClick={() => choose(item.id)}><strong>{item.label}</strong><span className="oui-help">{item.description || item.section}</span></Button>) : <p role="status">没有匹配的设置项</p>}</div>}
    </div>}
    {mobile && <IconButton ref={trigger} label={expanded ? '关闭设置搜索' : '搜索设置'} variant="quiet" aria-expanded={expanded} aria-controls={expanded ? 'settings-header-search-field' : undefined} onClick={() => { setExpanded(value => !value); setOpen(false); }}>{expanded ? <X size={19} aria-hidden="true" /> : <Search size={19} aria-hidden="true" />}</IconButton>}
  </div>;
}
