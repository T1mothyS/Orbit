const preferenceKey = 'orbit:admin-performance-sampling';
const pathAllowed = /^(?:\/api\/completions(?:\/[^/]+(?:\/reopen)?)?|\/api\/schedules(?:\/[^/]+(?:\/(?:toggle|actions))?)?|\/api\/orbit\/requests)$/;
type Metric = Record<string, string | number>;
let longTaskMs = 0;
let interactions = new Map<number, number>();
let observers: PerformanceObserver[] = [];

export function browserSamplingEnabled() {
  try { return sessionStorage.getItem(preferenceKey) === 'true'; } catch { return false; }
}

export function setBrowserSampling(enabled: boolean) {
  try { sessionStorage.setItem(preferenceKey, String(enabled)); } catch { return; }
  observers.forEach(observer => observer.disconnect());
  observers = [];
  longTaskMs = 0;
  interactions = new Map();
  if (!enabled || typeof PerformanceObserver !== 'function') return;
  for (const type of ['longtask', 'event'] as const) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    const observer = new PerformanceObserver(list => {
      for (const item of list.getEntries()) {
        if (type === 'longtask') longTaskMs = Math.max(longTaskMs, item.duration);
        else {
          const id = (item as PerformanceEntry & { interactionId?: number }).interactionId;
          if (id) interactions.set(id, Math.max(interactions.get(id) || 0, item.duration));
          if (interactions.size > 200) interactions.delete(interactions.keys().next().value!);
        }
      }
    });
    observer.observe({ type, buffered: false });
    observers.push(observer);
  }
}
if (typeof window !== 'undefined' && browserSamplingEnabled()) setBrowserSampling(true);

function resourceFields(timing?: PerformanceResourceTiming): Metric {
  if (!timing) return {};
  const value: Metric = {};
  if (timing.domainLookupEnd > timing.domainLookupStart) value.dnsMs = timing.domainLookupEnd - timing.domainLookupStart;
  if (timing.connectEnd > timing.connectStart) value.connectMs = timing.connectEnd - timing.connectStart;
  if (timing.secureConnectionStart > 0 && timing.connectEnd > timing.secureConnectionStart) value.tlsMs = timing.connectEnd - timing.secureConnectionStart;
  if (timing.responseStart > timing.requestStart && timing.requestStart > 0) value.ttfbMs = timing.responseStart - timing.requestStart;
  return value;
}

function sendBrowserSample(value: Metric, headerSource?: HeadersInit) {
  if (!browserSamplingEnabled()) return;
  const headers = new Headers(headerSource);
  if (!headers.has('Authorization')) return;
  headers.set('Content-Type', 'application/json');
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const ordered = [...interactions.values()].sort((a, b) => b - a);
  const interactionMs = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length / 50))];
  const body = {
    ...(navigation?.loadEventEnd ? { navigationMs: navigation.loadEventEnd } : {}),
    ...(longTaskMs ? { longTaskMs } : {}),
    ...(interactionMs !== undefined ? { interactionMs } : {}),
    ...value,
  };
  if (!Object.keys(body).length) return;
  void fetch('/api/system/performance/browser', { method: 'POST', headers, body: JSON.stringify(body), keepalive: true }).catch(() => {});
}

export function submitBrowserSnapshot(headers: HeadersInit) {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  sendBrowserSample(resourceFields(navigation), headers);
}

export async function monitoredFetch(input: string, init?: RequestInit) {
  if (!browserSamplingEnabled() || !pathAllowed.test(input) || !['POST', 'PUT', 'PATCH'].includes(init?.method || 'GET')) {
    return fetch(input, init);
  }
  const t = performance.now();
  const response = await fetch(input, init);
  const elapsed = performance.now() - t;
  const requestId = response.headers.get('X-Request-ID');
  if (requestId) {
    const url = new URL(input, window.location.origin).href;
    setTimeout(() => {
      const resources = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
      const timing = resources.filter(entry => entry.startTime >= t - 1).at(-1);
      sendBrowserSample({ ...resourceFields(timing), requestId, requestMs: elapsed }, init?.headers);
    }, 0);
  }
  return response;
}
