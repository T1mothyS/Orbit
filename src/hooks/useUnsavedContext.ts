import { useContext, useEffect, useRef } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

let activePopGuard: ((event: PopStateEvent) => void) | undefined;
let installed = false;
// Install before BrowserRouter subscribes: POP is not cancelable, and listeners on
// window run in registration order. A late listener cannot undo a scheduled render.
export function initializeUnsavedContextGuard() {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', event => activePopGuard?.(event), true);
}

// BrowserRouter has no data-router blocker. Guard its navigator and indexed POPs locally.
// Nothing from the form is stored in browser storage or history.
export function useUnsavedContext(dirty: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const message = '资料尚未保存，离开会丢弃当前修改。是否离开？';
    const originalPush = navigator.push, originalReplace = navigator.replace;
    const permitted = (to: Parameters<typeof navigator.push>[0]) => {
      const pathname = typeof to === 'string' ? new URL(to, window.location.href).pathname : to.pathname;
      return !dirtyRef.current || !pathname || pathname === window.location.pathname || window.confirm(message);
    };
    navigator.push = (...args) => { if (permitted(args[0])) { originalPush.apply(navigator, args); index = window.history.state?.idx; } };
    navigator.replace = (...args) => { if (permitted(args[0])) { originalReplace.apply(navigator, args); index = window.history.state?.idx; } };
    let index: number | undefined = window.history.state?.idx;
    const pathname = window.location.pathname;
    let restoring = false;
    const pop = (event: PopStateEvent) => {
      const nextIndex: number | undefined = event.state?.idx;
      if (restoring) { event.stopImmediatePropagation(); restoring = false; index = nextIndex; return; }
      if (dirtyRef.current && window.location.pathname !== pathname && index !== undefined && nextIndex !== undefined && nextIndex !== index && !window.confirm(message)) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(index - nextIndex);
      } else index = nextIndex;
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    activePopGuard = pop;
    window.addEventListener('beforeunload', unload);
    return () => {
      navigator.push = originalPush; navigator.replace = originalReplace;
      if (activePopGuard === pop) activePopGuard = undefined;
      window.removeEventListener('beforeunload', unload);
    };
  }, [navigator]);
}
