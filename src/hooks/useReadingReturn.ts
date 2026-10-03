import { useLayoutEffect, useRef, type RefObject } from 'react';

// Session-only, bounded and account-scoped. No article text or credentials are cached.
const positions = new Map<string, { top: number; selection: unknown; focus?: string }>();
let account = '';

export function useReadingReturn<T>(owner: string | undefined, key: string, ref: RefObject<HTMLElement>, ready: boolean,
  selection?: T, restoreSelection?: (value: T) => void) {
  const latest = useRef(selection);
  latest.current = selection;
  const restore = useRef(restoreSelection);
  restore.current = restoreSelection;
  const restored = useRef('');
  const scrollRestored = useRef('');
  useLayoutEffect(() => {
    if (!owner) return;
    if (account !== owner) { positions.clear(); account = owner; }
    const identity = `${owner}:${key}`;
    if (restored.current !== identity) {
      restored.current = identity;
      scrollRestored.current = '';
      const saved = positions.get(key);
      if (saved?.selection !== undefined) restore.current?.(saved.selection as T);
    }
  }, [owner, key]);
  useLayoutEffect(() => {
    if (!owner || !ready || !ref.current || scrollRestored.current === `${owner}:${key}`) return;
    const saved = positions.get(key);
    ref.current.scrollTop = saved?.top || 0;
    if (saved?.focus) ref.current.querySelector<HTMLElement>(`[data-reader-key="${CSS.escape(saved.focus)}"]`)?.focus({ preventScroll: true });
    scrollRestored.current = `${owner}:${key}`;
  }, [owner, key, ref, ready]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!owner || !element || !ready) return;
    let focused = positions.get(key)?.focus;
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reader-key]') : null;
      if (target) focused = target.dataset.readerKey;
    };
    const save = () => {
      if (account !== owner) return;
      positions.set(key, { top: element.scrollTop, selection: latest.current, focus: focused });
      if (positions.size > 32) positions.delete(positions.keys().next().value!);
    };
    element.addEventListener('scroll', save, { passive: true });
    element.addEventListener('focusin', rememberFocus);
    return () => { save(); element.removeEventListener('scroll', save); element.removeEventListener('focusin', rememberFocus); };
  }, [owner, key, ref, ready]);
}
