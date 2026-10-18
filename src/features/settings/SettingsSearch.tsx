import { useState } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Button,Input } from '../../ui';
import { moduleSettingsPath } from '../../utils/module-settings';
import { findSettings } from '../../utils/settings-registry';
export function SettingsSearch() {
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [selected, setSelected] = useState(0);
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate();
  const results = findSettings(query, user?.role === 'admin').slice(0, 12);
  const choose = (id: string) => { setQuery(''); setOpen(false); navigate(`${moduleSettingsPath(id)}?settings=${encodeURIComponent(id)}`, { state: location.state }); };
  return <div className="settings-search" data-settings-search-open={open && !!query}>
    <label className="oui-label" htmlFor="orbit-settings-search">搜索设置</label>
    <Input id="orbit-settings-search" role="combobox" aria-autocomplete="list" aria-expanded={open && !!query} aria-controls="orbit-settings-search-results" aria-activedescendant={open && query && results[selected] ? `setting-result-${results[selected].id}` : undefined} placeholder="名称或关键词" autoComplete="off" value={query} onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) setOpen(false); }} onChange={event => { setQuery(event.target.value); setSelected(0); setOpen(true); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setSelected(value => Math.max(0, Math.min(results.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && open && query && results[selected]) { event.preventDefault(); choose(results[selected].id); }
    }} />
    {open && query && <div className="settings-search-results" id="orbit-settings-search-results" role="listbox" aria-label="设置搜索结果">{results.length ? results.map((item, index) => <Button key={item.id} variant="quiet" id={`setting-result-${item.id}`} role="option" aria-selected={index === selected} onMouseDown={event => event.preventDefault()} onClick={() => choose(item.id)}><strong>{item.label}</strong><span className="oui-help">{item.description || item.section}</span></Button>) : <p role="status">没有匹配的设置项</p>}</div>}
  </div>;
}
