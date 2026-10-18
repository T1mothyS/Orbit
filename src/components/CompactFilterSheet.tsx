import { useEffect, useRef, type ReactNode } from 'react';
import { Button, Sheet } from '../ui';

export function CompactFilterSheet({ title, children, busy = false, error, onClose, onReset, onApply }: { title: string; children: ReactNode; busy?: boolean; error?: string | null; onClose: () => void; onReset: () => void; onApply: () => void }) {
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) feedback.current?.focus(); }, [error]);
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }} title={title} busy={busy} footer={<>
    <Button disabled={busy} onClick={onReset}>重置</Button><Button disabled={busy} onClick={onClose}>取消</Button>
    <Button variant="primary" loading={busy} onClick={onApply}>应用</Button>
  </>}><fieldset className="compact-filter-fields" disabled={busy}>{children}</fieldset>{error && <p ref={feedback} tabIndex={-1} className="orbit-inline-error" role="alert">{error}</p>}</Sheet>;
}
