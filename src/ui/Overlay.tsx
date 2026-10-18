import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Dialog as PrimitiveDialog } from '@base-ui/react/dialog';
import { Menu as PrimitiveMenu } from '@base-ui/react/menu';
import { Popover as PrimitivePopover } from '@base-ui/react/popover';
import { Tooltip as PrimitiveTooltip } from '@base-ui/react/tooltip';
import { Button, IconButton } from './Button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  canClose?: () => boolean;
  size?: 'default' | 'wide';
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus?: RefObject<HTMLElement | null>;
}
function Overlay({ open, onOpenChange, title, description, children, footer, busy = false, canClose, size = 'default', initialFocus, returnFocus, sheet = false }: DialogProps & { sheet?: boolean }) {
  const close = useRef<HTMLButtonElement>(null);
  return <PrimitiveDialog.Root open={open} onOpenChange={(next, details) => {
    if (!next && (busy || canClose?.() === false)) details.cancel(); else onOpenChange(next);
  }} disablePointerDismissal={busy}>
    <PrimitiveDialog.Portal>
      <PrimitiveDialog.Backdrop className="oui-backdrop" />
      <PrimitiveDialog.Viewport className={`oui-overlay ${sheet ? 'oui-overlay--sheet' : ''}`}>
        <PrimitiveDialog.Popup className={`oui-root oui-popup${size === 'wide' ? ' oui-popup--wide' : ''} ${sheet ? 'oui-sheet' : ''}`} aria-busy={busy || undefined}
          initialFocus={initialFocus || close} finalFocus={returnFocus}>
          <header className="oui-popup-header"><div><PrimitiveDialog.Title className="oui-popup-title">{title}</PrimitiveDialog.Title>
            {description && <PrimitiveDialog.Description className="oui-help">{description}</PrimitiveDialog.Description>}</div>
            <PrimitiveDialog.Close render={<IconButton ref={close} label={`关闭${title}`} variant="quiet" disabled={busy}><X size={19} /></IconButton>} />
          </header>
          <div className="oui-popup-body">{children}</div>
          {footer && <footer className="oui-popup-footer">{footer}</footer>}
        </PrimitiveDialog.Popup>
      </PrimitiveDialog.Viewport>
    </PrimitiveDialog.Portal>
  </PrimitiveDialog.Root>;
}
export function Dialog(props: DialogProps) { return <Overlay {...props} />; }
export function Sheet(props: DialogProps) { return <Overlay {...props} sheet />; }
export function ConfirmDialog({ onConfirm, confirmLabel, children, ...props }: Omit<DialogProps, 'footer'> & { onConfirm: () => void; confirmLabel: string }) {
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog {...props} initialFocus={cancel} footer={<>
    <Button ref={cancel} onClick={() => props.onOpenChange(false)} disabled={props.busy}>取消</Button>
    <Button variant="danger" onClick={onConfirm} loading={props.busy}>{confirmLabel}</Button>
  </>}>{children}</Dialog>;
}

export interface MenuItem { id: string; label: string; onSelect: () => void; icon?: ReactNode; disabled?: boolean; danger?: boolean; separatorBefore?: boolean }
export function Menu({ trigger, label, items, header, footer, navigation = false }: { trigger: ReactElement; label: string; items: MenuItem[]; header?: ReactNode; footer?: ReactNode; navigation?: boolean }) {
  const [mobile, setMobile] = useState(() => navigation && window.matchMedia('(max-width: 767px)').matches);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!navigation) return;
    const query = window.matchMedia('(max-width: 767px)'), change = () => { setMobile(query.matches); setOpen(false); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [navigation]);
  if (navigation && mobile) return <>
    {cloneElement(trigger as ReactElement<Record<string, unknown>>, { onClick: () => setOpen(true), 'aria-haspopup': 'dialog', 'aria-expanded': open })}
    <Sheet open={open} onOpenChange={setOpen} title={label} footer={footer}>
      {header && <div className="oui-menu-caption">{header}</div>}
      <nav className="oui-navigation-menu" aria-label={label}>{items.map(item => <div key={item.id}>
        {item.separatorBefore && <hr className="oui-menu-separator" />}
        <Button variant={item.danger ? 'danger' : 'quiet'} leadingIcon={item.icon} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>{item.label}</Button>
      </div>)}</nav>
    </Sheet>
  </>;
  return <PrimitiveMenu.Root><PrimitiveMenu.Trigger render={trigger} />
    <PrimitiveMenu.Portal><PrimitiveMenu.Positioner sideOffset={6} align="end" className="oui-positioner">
      <PrimitiveMenu.Popup className={`oui-menu${navigation ? ' oui-menu--navigation' : ''}`} aria-label={label}>{header && <div className="oui-menu-caption">{header}</div>}{items.map(item => <div key={item.id} role="presentation">
        {item.separatorBefore && <PrimitiveMenu.Separator className="oui-menu-separator" />}
        <PrimitiveMenu.Item className={`oui-menu-item ${item.danger ? 'oui-menu-item--danger' : ''}`} disabled={item.disabled} onClick={item.onSelect}>
          {item.icon}<span>{item.label}</span>
        </PrimitiveMenu.Item></div>)}{footer && <div className="oui-menu-caption">{footer}</div>}</PrimitiveMenu.Popup>
    </PrimitiveMenu.Positioner></PrimitiveMenu.Portal>
  </PrimitiveMenu.Root>;
}
export function Tooltip({ children, content }: { children: ReactElement; content: string }) {
  return <PrimitiveTooltip.Provider delay={400}><PrimitiveTooltip.Root><PrimitiveTooltip.Trigger render={children} />
    <PrimitiveTooltip.Portal><PrimitiveTooltip.Positioner sideOffset={6} className="oui-positioner"><PrimitiveTooltip.Popup className="oui-tooltip">{content}</PrimitiveTooltip.Popup></PrimitiveTooltip.Positioner></PrimitiveTooltip.Portal>
  </PrimitiveTooltip.Root></PrimitiveTooltip.Provider>;
}
export function Popover({ trigger, title, children }: { trigger: ReactElement; title: string; children: ReactNode }) {
  return <PrimitivePopover.Root><PrimitivePopover.Trigger render={trigger} />
    <PrimitivePopover.Portal><PrimitivePopover.Positioner sideOffset={8} className="oui-positioner">
      <PrimitivePopover.Popup className="oui-menu oui-popover"><PrimitivePopover.Title className="oui-label">{title}</PrimitivePopover.Title>{children}</PrimitivePopover.Popup>
    </PrimitivePopover.Positioner></PrimitivePopover.Portal>
  </PrimitivePopover.Root>;
}
