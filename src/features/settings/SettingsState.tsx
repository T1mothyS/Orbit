import { createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useUnsavedContext } from '../../hooks/useUnsavedContext';
import { useToast } from '../../ui';
import { ContextStore,NotificationStore } from './state';

const SettingsState = createContext<ReturnType<typeof createState> | null>(null);
function createState(headers: Record<string, string>, signal: AbortSignal) {
  const request: typeof fetch = async (input, init = {}) => {
    signal.throwIfAborted();
    const captured = new Headers(init.headers); for (const [name, value] of Object.entries(headers)) captured.set(name, value);
    const response = await fetch(input, { ...init, headers: captured, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
    signal.throwIfAborted(); return response;
  };
  return { context: new ContextStore(headers, request), notifications: new NotificationStore(headers, request), request, authHeaders: () => headers };
}
export function SettingsStateProvider({ children }: { children: ReactNode }) {
  const { authHeaders } = useAuth();
  const [owner] = useState(() => { const controller = new AbortController(); return { controller, ...createState(authHeaders(), controller.signal) }; });
  // StrictMode replays effects; the request lifetime is reset by a fresh account mount.
  useEffect(() => () => { queueMicrotask(() => { if (!mounted.current) owner.controller.abort(); }); }, [owner]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <SettingsState.Provider value={owner}><SettingsGuard>{children}</SettingsGuard></SettingsState.Provider>;
}
export function useSettingsState() { const owner = useContext(SettingsState); if (!owner) throw new Error('Settings must be inside its account-scoped parent.'); return owner; }
export function useContextState() { const owner = useSettingsState().context; return { ...useSyncExternalStore(owner.subscribe, owner.snapshot), owner }; }
export function useNotificationState() { const owner = useSettingsState().notifications; return { ...useSyncExternalStore(owner.subscribe, owner.snapshot), owner }; }

const DirtyRegistry = createContext<(id: string, dirty: boolean) => void>(() => undefined);
function SettingsGuard({ children }: { children: ReactNode }) {
  const context = useContextState(), notification = useNotificationState();
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const register = useCallback((id: string, value: boolean) => setDirty(current => current[id] === value ? current : { ...current, [id]: value }), []);
  useUnsavedContext(context.owner.dirty() || notification.owner.dirty() || Object.values(dirty).some(Boolean), { preserveWithin: '/settings', message: '设置尚未保存，离开会丢弃当前修改。是否离开？' });
  return <DirtyRegistry.Provider value={register}>{children}</DirtyRegistry.Provider>;
}
export function useSettingsDirty(id: string, dirty: boolean) {
  const register = useContext(DirtyRegistry);
  useEffect(() => { register(id, dirty); return () => register(id, false); }, [id, dirty, register]);
}
const Activity = createContext(true);
export function SettingsActivity({ active, children }: { active: boolean; children: ReactNode }) { return <Activity.Provider value={active}>{children}</Activity.Provider>; }
export function useSettingsActive() { return useContext(Activity); }
/** Local request lifetime ends on category exit; credentials remain captured by the parent. */
export function useSettingsRequest(): typeof fetch {
  const { request } = useSettingsState(), active = useSettingsActive();
  const lifetime = useRef(new AbortController());
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; if (!active) controller.abort(); return () => controller.abort(); }, [active]);
  return useCallback(async (input, init = {}) => {
    const signal = lifetime.current.signal; signal.throwIfAborted();
    const response = await request(input, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
    signal.throwIfAborted(); return response;
  }, [request]);
}
export function useClearSensitive(clear: () => void) {
  const active = useSettingsActive(), latest = useRef(clear); latest.current = clear;
  useEffect(() => { if (!active) latest.current(); }, [active]);
}
export function useSettingsFeedback() {
  const toast = useToast(), active = useSettingsActive();
  const current = useRef({ toast, active }); current.current = { toast, active };
  return useMemo(() => ({
    success: (title: string) => { if (current.current.active) current.current.toast.show({ title }); },
    warning: (title: string) => { if (current.current.active) current.current.toast.show({ title, tone: 'warning' }); },
    error: (title: string) => { if (current.current.active) current.current.toast.show({ title, tone: 'danger' }); },
  }), []);
}
