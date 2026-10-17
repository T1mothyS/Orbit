/** Single application owner for Orbit login state; credentials never enter feature stores. */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearAccountComposerDrafts } from '../utils/composer-draft';
import { androidLogout } from '../services/android-bridge';

export interface User { id: string; email: string; role: 'admin' | 'user' }
interface AuthState { user: User | null; token: string | null; isLoading: boolean; isAuthenticated: boolean }
interface AuthContextValue extends AuthState {
  notice: string;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, code: string, invite_code: string) => Promise<void>;
  sendRegisterCode: (email: string, password: string, invite_code: string) => Promise<void>;
  logout: () => void;
  endSession: (notice?: string) => void;
  checkAuth: () => Promise<void>;
  authHeaders: () => Record<string, string>;
}
const TOKEN_KEY = 'aicalendar_token';
const AuthContext = createContext<AuthContextValue | null>(null);
export function getStoredAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({ user: null, token: localStorage.getItem(TOKEN_KEY), isLoading: true, isAuthenticated: false }));
  const current = useRef(state), revision = useRef(0);
  const validationRequest = useRef<AbortController>(), loginRequest = useRef<AbortController>();
  const [notice, setNotice] = useState('');
  const commit = useCallback((next: AuthState) => { current.current = next; setState(next); }, []);
  const endSession = useCallback((message = '') => {
    revision.current++;
    // Prevent a late identity response from renewing a Tools cookie after logout.
    validationRequest.current?.abort(); loginRequest.current?.abort();
    androidLogout();
    if (current.current.user?.id) clearAccountComposerDrafts(current.current.user.id);
    localStorage.removeItem(TOKEN_KEY);
    setNotice(message);
    commit({ user: null, token: null, isLoading: false, isAuthenticated: false });
  }, [commit]);
  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY), request = ++revision.current;
    validationRequest.current?.abort();
    const controller = new AbortController(); validationRequest.current = controller;
    if (current.current.token !== token) {
      loginRequest.current?.abort();
      if (current.current.user?.id) clearAccountComposerDrafts(current.current.user.id);
      commit({ user: null, token, isLoading: !!token, isAuthenticated: false });
    }
    if (!token) { commit({ user: null, token: null, isLoading: false, isAuthenticated: false }); return; }
    const active = () => revision.current === request && localStorage.getItem(TOKEN_KEY) === token;
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin', signal: controller.signal });
      if (!active()) return;
      if (res.ok) {
        const data = await res.json();
        if (active()) commit({ user: data.user, token, isLoading: false, isAuthenticated: true });
      } else if (res.status === 401 || res.status === 403) endSession('登录状态已失效，请重新登录。');
      else commit({ ...current.current, token, isLoading: false });
    } catch { if (active()) commit({ ...current.current, token, isLoading: false }); }
  }, [commit, endSession]);
  useEffect(() => {
    void checkAuth();
    const storage = (event: StorageEvent) => { if (event.key === TOKEN_KEY || event.key === null) void checkAuth(); };
    const focus = () => { if (localStorage.getItem(TOKEN_KEY) && !loginRequest.current) void checkAuth(); };
    window.addEventListener('storage', storage); window.addEventListener('focus', focus);
    return () => { revision.current++; validationRequest.current?.abort(); loginRequest.current?.abort(); window.removeEventListener('storage', storage); window.removeEventListener('focus', focus); };
  }, [checkAuth]);
  const authenticate = useCallback(async (url: string, body: Record<string, string>) => {
    const request = ++revision.current;
    validationRequest.current?.abort(); loginRequest.current?.abort();
    const controller = new AbortController(); loginRequest.current = controller;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body), signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录失败');
      if (request !== revision.current) throw new Error('登录状态已变化，请重试。');
      if (current.current.user?.id && current.current.user.id !== data.user.id) clearAccountComposerDrafts(current.current.user.id);
      localStorage.setItem(TOKEN_KEY, data.token);
      setNotice(''); commit({ user: data.user, token: data.token, isLoading: false, isAuthenticated: true });
    } finally { if (loginRequest.current === controller) loginRequest.current = undefined; }
  }, [commit]);
  const login = useCallback((email: string, password: string) => authenticate('/api/auth/login', { email, password }), [authenticate]);
  const register = useCallback((email: string, password: string, code: string, invite_code: string) => authenticate('/api/auth/register', { email, password, code, invite_code }), [authenticate]);
  const sendRegisterCode = useCallback(async (email: string, password: string, invite_code: string) => {
    const res = await fetch('/api/auth/send-register-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email, password, invite_code }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || '发送验证码失败');
  }, []);
  const logout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
    endSession();
  }, [endSession]);
  const authHeaders = useCallback(getStoredAuthHeaders, []);
  const value = useMemo(() => ({ ...state, notice, login, register, sendRegisterCode, logout, endSession, checkAuth, authHeaders }), [state, notice, login, register, sendRegisterCode, logout, endSession, checkAuth, authHeaders]);
  return createElement(AuthContext.Provider, { value }, children);
}
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires the application AuthProvider.');
  return context;
}
