import { useLayoutEffect, type RefObject } from 'react';

/** Native dialogs provide focus containment and make the background inert, including nested dialogs. */
export function useDialogLifecycle(ref: RefObject<HTMLDialogElement>, open = true, initialFocus?: string) {
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog.showModal();
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref, open, initialFocus]);
}
