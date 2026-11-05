import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { isAndroid } from '../services/android-bridge';
export function BrowserNotifications() {
  const { authHeaders } = useAuth();
  useEffect(() => {
    if (isAndroid()) return;
    const controller = new AbortController();
    const { signal } = controller;
    const shown = new Set<string>();
    let busy = false;
    const poll = async () => {
      if (signal.aborted || busy || !('Notification' in window) || Notification.permission !== 'granted') return;
      busy = true;
      try {
        const response = await fetch('/api/notifications?popup=1', { headers: authHeaders(), signal });
        if (!response.ok) return;
        const { popups = [] } = await response.json();
        for (const item of popups) {
          if (signal.aborted) return;
          if (!shown.has(item.id)) {
            new Notification(item.title, { body: item.body, tag: item.id });
            shown.add(item.id);
          }
          const ack = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
            method: 'POST', headers: authHeaders(), signal,
          });
          if (ack.ok) shown.delete(item.id);
        }
      } catch {
        // Retry on the next poll without showing the same reminder twice.
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 60_000);
    window.addEventListener('focus', poll);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [authHeaders]);
  return null;
}
