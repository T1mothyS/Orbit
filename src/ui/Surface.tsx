import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Inbox, LoaderCircle, CircleHelp } from 'lucide-react';
import { Tabs as PrimitiveTabs } from '@base-ui/react/tabs';
import { Button } from './Button';
import { Popover } from './Overlay';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`oui-card ${className}`} />;
}
export function Section({ title, description, children, id, action, hideTitle = false }: { title: string; description?: ReactNode; children: ReactNode; id?: string; action?: ReactNode; hideTitle?: boolean }) {
  return <section className="oui-section" id={id} aria-label={title} tabIndex={id ? -1 : undefined}>
    <header className="oui-section-heading"><div><h2 className={hideTitle ? 'oui-visually-hidden' : undefined}>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>
    <div>{children}</div>
  </section>;
}
export function SettingRow({ label, description, help, children, htmlFor, id }: { label: string; description?: ReactNode; help?: string; children: ReactNode; htmlFor?: string; id?: string }) {
  return <div className="oui-setting-row" id={id} tabIndex={id ? -1 : undefined}>
    <div className="oui-setting-copy"><div className="oui-setting-label">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <h3>{label}</h3>}{help && <Popover openOnHover title={label} trigger={<button type="button" className="oui-help-trigger" aria-label={`了解${label}`}><CircleHelp size={16} /></button>}><p>{help}</p></Popover>}</div>{description && <p>{description}</p>}</div>
    <div className="oui-setting-control">{children}</div>
  </div>;
}
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand'; children: ReactNode }) {
  return <span className={`oui-badge oui-tone--${tone}`}>{children}</span>;
}
export function InlineNotice({ tone = 'success', title, children }: { tone?: 'success' | 'warning' | 'danger'; title: string; children?: ReactNode }) {
  return <div className={`oui-notice oui-tone--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    {tone === 'success' ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
    <div><strong>{title}</strong>{children && <p>{children}</p>}</div>
  </div>;
}
export function Skeleton({ label = '正在加载内容' }: { label?: string }) {
  return <div className="oui-skeleton" role="status" aria-label={label}><span /><span /><span /></div>;
}
export function LoadingState({ label = '正在读取设置…' }: { label?: string }) {
  return <div className="oui-state oui-state--loading" role="status"><LoaderCircle className="oui-spinner" size={18} aria-hidden="true" /><span>{label}</span></div>;
}
export function EmptyState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="oui-state"><Inbox size={22} className="oui-muted-text" aria-hidden="true" /><div><h3>{title}</h3><p>{description}</p></div>
    {actionLabel && onAction && <Button onClick={onAction}>{actionLabel}</Button>}
  </div>;
}
export function ErrorState({ title = '暂时无法读取设置', description, onRetry }: { title?: string; description: string; onRetry: () => void }) {
  return <div className="oui-state oui-state--error" role="alert"><AlertCircle size={20} aria-hidden="true" /><div><h3>{title}</h3><p>{description}</p></div><Button onClick={onRetry}>重新读取</Button></div>;
}
export function Tabs({ label, value, onValueChange, items, keepMounted = false, disabled = false }: { disabled?: boolean; label: string; value: string; onValueChange: (value: string) => void; items: { value: string; label: string; content: ReactNode }[]; keepMounted?: boolean }) {
  return <PrimitiveTabs.Root value={value} onValueChange={next => onValueChange(String(next))}>
    <PrimitiveTabs.List className="oui-tabs" aria-label={label} activateOnFocus>
      {items.map(item => <PrimitiveTabs.Tab key={item.value} value={item.value} disabled={disabled} className="oui-tab">{item.label}</PrimitiveTabs.Tab>)}
    </PrimitiveTabs.List>
    {items.map(item => <PrimitiveTabs.Panel key={item.value} value={item.value} keepMounted={keepMounted} className="oui-tab-panel">{item.content}</PrimitiveTabs.Panel>)}
  </PrimitiveTabs.Root>;
}
