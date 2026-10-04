import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';

export function CompactFilterSheet({ title, children, busy = false, error, onClose, onReset, onApply }: { title: string; children: ReactNode; busy?: boolean; error?: string | null; onClose: () => void; onReset: () => void; onApply: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useDialogLifecycle(dialog);
  return createPortal(<dialog ref={dialog} className="orbit-dialog-viewport compact-sheet-overlay" aria-labelledby="compact-filter-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className="compact-sheet"><header><h2 id="compact-filter-title">{title}</h2><button type="button" disabled={busy} aria-label="关闭筛选" onClick={onClose}><X size={20} /></button></header><div className="compact-sheet-body"><fieldset disabled={busy}>{children}</fieldset>{error && <p className="orbit-inline-error" role="alert">{error}</p>}</div><footer><button type="button" className="secondary-button" disabled={busy} onClick={onReset}>重置</button><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={busy} onClick={onApply}>{busy ? '应用中…' : '应用'}</button></footer></section></dialog>, document.body);
}
