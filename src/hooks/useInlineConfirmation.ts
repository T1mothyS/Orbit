import { useCallback, useEffect, useRef, useState } from 'react';

export function useInlineConfirmation(scope: string) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const reset = useCallback(() => { pendingRef.current = null; setPending(null); }, []);

  useEffect(reset, [scope, reset]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(reset, 5000);
    const outside = (event: PointerEvent) => {
      const button = event.target instanceof Element ? event.target.closest('[data-confirm-action]') : null;
      if (button?.getAttribute('data-confirm-action') !== pending) reset();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => { window.clearTimeout(timer); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [pending, reset]);

  const confirm = useCallback(async (key: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    if (pendingRef.current !== key) { pendingRef.current = key; setPending(key); return; }
    reset();
    busyRef.current = true; setBusy(key);
    try { await operation(); }
    finally { busyRef.current = false; setBusy(null); }
  }, [reset]);
  return { pending, busy, confirm, reset };
}

export type InlineConfirmation = ReturnType<typeof useInlineConfirmation>;
