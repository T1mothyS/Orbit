import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, ConfirmPopover } from './Overlay';

export interface ActionConfirmationOptions {
  title: string; description: string; confirmLabel?: string; kind?: 'dialog' | 'popover'; key?: string;
  anchor?: HTMLElement | null; portalContainer?: HTMLElement | null;
}
type Pending = ActionConfirmationOptions & { operation: () => unknown | Promise<unknown>; resolve: (accepted: boolean) => void; anchor: HTMLElement | null; portalContainer: HTMLElement | null };
/** Owns one pending operation; confirmation never reads a later selection or runs twice. */
export function useActionConfirmation() {
  const [request, setRequest] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef<Pending | null>(null), executing = useRef(false), mounted = useRef(true), returnFocus = useRef<HTMLElement | null>(null);
  const finish = useCallback((accepted: boolean) => {
    current.current?.resolve(accepted); current.current = null; executing.current = false;
    if (mounted.current) { setRequest(null); setBusy(false); setError(''); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; current.current?.resolve(false); current.current = null; }; }, []);
  const run = useCallback((options: ActionConfirmationOptions, operation: Pending['operation']) => {
    if (current.current) return Promise.resolve(false);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const anchor = options.anchor ?? active;
    const nativeDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
    const portalContainer = options.portalContainer ?? active?.closest<HTMLDialogElement>('dialog[open]') ?? nativeDialogs.item(nativeDialogs.length - 1);
    returnFocus.current = anchor?.matches('button,a,input,select,textarea,[tabindex]') ? anchor : anchor?.querySelector<HTMLElement>('button,a,[tabindex]') ?? active;
    return new Promise<boolean>(resolve => {
      const pending = { ...options, operation, resolve, anchor, portalContainer };
      current.current = pending; setError(''); setBusy(false);
      setRequest(pending);
    });
  }, []);
  const accept = async () => {
    const pending = current.current; if (!pending || executing.current) return;
    executing.current = true; setBusy(true); setError('');
    try {
      const result = await pending.operation();
      if (result === false) throw new Error('操作未完成，内容已保留，请重试。');
      finish(true);
    } catch (cause) {
      if (mounted.current && current.current === pending) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); setBusy(false); }
      executing.current = false;
    }
  };
  const cancel = (open: boolean) => { if (!open && !executing.current) finish(false); };
  const discard = (dirty: boolean, operation: () => void, description = '放弃本次未保存的编辑？') => {
    if (!dirty) return true;
    void run({ title: '放弃未保存的修改？', description, confirmLabel: '放弃修改' }, operation); return false;
  };
  const dialog = request && (request.kind === 'popover' && request.anchor?.isConnected
    ? <ConfirmPopover open title={request.title} description={request.description} confirmLabel={request.confirmLabel || '确认操作'} anchor={request.anchor} portalContainer={request.portalContainer} returnFocus={returnFocus} onOpenChange={cancel} onConfirm={() => void accept()} busy={busy} error={error} />
    : <ConfirmDialog open title={request.title} description={request.description} confirmLabel={request.confirmLabel || '确认操作'} portalContainer={request.portalContainer} returnFocus={returnFocus} onOpenChange={cancel} onConfirm={() => void accept()} busy={busy}>{error && <p className="oui-confirm-error" role="alert">{error}</p>}</ConfirmDialog>);
  return { run, discard, dialog, open: !!request, busy: busy ? request?.key || 'action' : null };
}
export type ActionConfirmation = ReturnType<typeof useActionConfirmation>;
