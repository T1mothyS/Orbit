import { useActionConfirmation } from '../ui';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';

/** One closing path for pointer, Escape and the explicit close action. */
export function OrbitDialog({ label, onClose, busy = false, error, canClose, children, className = '', discardMessage }: {
  label: string; onClose: () => void; busy?: boolean; canClose?: () => boolean; discardMessage?: string;
  children: ReactNode | ((close: () => void) => ReactNode); className?: string; error?: string;
}) {
  const confirmation = useActionConfirmation();
  const dialog = useRef<HTMLDialogElement>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const id = useId();
  useDialogLifecycle(dialog);
  useLayoutEffect(() => {
    if (!error || busy) return;
    const alert = dialog.current?.querySelector<HTMLElement>('[role="alert"]');
    if (alert) { alert.tabIndex = -1; alert.focus({ preventScroll: true }); alert.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
  }, [error, busy]);
  const close = () => {
    if (busy || closingRef.current || confirmation.open) return;
    if (canClose?.() === false) {
      if (discardMessage) void confirmation.run({ title: '放弃未保存的修改？', description: discardMessage, confirmLabel: '放弃修改', portalContainer: dialog.current }, onClose);
      return;
    }
    closingRef.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    setClosing(true);
  };
  return createPortal(<dialog ref={dialog} id={id} aria-label={label} aria-busy={busy}
    className={`orbit-dialog-frame ${className}${closing ? ' is-closing' : ''}`}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    {confirmation.dialog}
    <div className="orbit-dialog-content" onAnimationEnd={event => {
      if (closing && event.target === event.currentTarget) onClose();
    }}>{typeof children === 'function' ? children(close) : children}</div>
  </dialog>, document.body);
}
