import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { androidCall, isAndroid } from '../services/android-bridge';

interface TodayWidgetBridge {
  available(): Promise<boolean>;
  write(snapshot: unknown): Promise<boolean>;
  clear(): Promise<boolean>;
}
const macBridge = () => (window as Window & { orbitTodayWidget?: TodayWidgetBridge }).orbitTodayWidget;
export function useTodayWidget() {
  const { user, token, isAuthenticated } = useAuth();
  useEffect(() => {
    if (!user || !token || !isAuthenticated) return;
    const mac = macBridge();
    if (!mac && !isAndroid()) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let syncing = false;
    let enabled: boolean | undefined;
    const sync = async () => {
      if (syncing || controller.signal.aborted || document.visibilityState !== 'visible') return;
      syncing = true;
      const headers = { Authorization: `Bearer ${token}` };
      const active = () => !controller.signal.aborted && localStorage.getItem('aicalendar_token') === token;
      try {
        if (mac) {
          enabled ??= await mac.available();
          if (!enabled || !active()) return;
          const response = await fetch('/api/action-center/widget', { headers, signal: controller.signal });
          if (response.status === 401 || response.status === 403) {
            if (active()) await mac.clear();
            return;
          }
          if (!response.ok) return;
          const snapshot: unknown = await response.json();
          if (active()) await mac.write(snapshot);
        } else if (enabled !== false) {
          const status = await androidCall<{ installed: boolean; expiresAt: number }>('todayWidgetStatus', { accountId: user.id });
          if (!status.installed || !active()) return;
          if (status.expiresAt > Date.now() + 60 * 60 * 1000) {
            await androidCall('todayWidgetRefresh', { accountId: user.id });
            return;
          }
          const response = await fetch('/api/action-center/widget/access', { method: 'POST', headers, signal: controller.signal });
          if (!response.ok) return;
          const { credential, expiresAt } = await response.json();
          if (active()) await androidCall('todayWidgetAccess', { accountId: user.id, credential, expiresAt });
        }
      } catch (error) {
        if (error instanceof Error && error.message === '未知 Android 操作') enabled = false;
        // The native widget retains the last valid snapshot and displays its sync time.
      } finally { syncing = false; }
    };
    const scheduleSync = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void sync(), 400);
    };
    void sync();
    const poll = window.setInterval(() => void sync(), 15 * 60 * 1000);
    window.addEventListener('focus', scheduleSync);
    window.addEventListener('orbit:data-change', scheduleSync);
    document.addEventListener('visibilitychange', scheduleSync);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(poll);
      window.removeEventListener('focus', scheduleSync);
      window.removeEventListener('orbit:data-change', scheduleSync);
      document.removeEventListener('visibilitychange', scheduleSync);
    };
  }, [isAuthenticated, token, user?.id]);
}
