import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operationsDirectory } from './operations-state.js';
import { observesOperation } from './system-events.js';
import type { ApiTiming } from './performance-alert-rules.js';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const buckets = [25, 50, 100, 250, 500, 1000, 1500, 2000, 3000, 5000, 10000, 30000, 60000];
const ranges = { '5m': 5 * MINUTE, '1h': HOUR, '24h': DAY, '30d': 30 * DAY } as const;
type Range = keyof typeof ranges;
type Histogram = { count: number; errors: number; histogram: number[] };
type TimeRow = { at: number; routes: Record<string, Histogram> };
type Trace = Omit<ApiTiming, 'operationId'> & { id: string; route: string };
const phases = ['sqlMs', 'exportMs', 'writeMs', 'syncMs'] as const;
const browserFields = ['navigationMs', 'dnsMs', 'connectMs', 'tlsMs', 'ttfbMs', 'requestMs', 'longTaskMs', 'interactionMs'] as const;
type BrowserMetric = typeof browserFields[number];
type BrowserSample = Partial<Record<BrowserMetric, number>> & { observedAt: number; requestId?: string };
const minute = new Map<number, TimeRow>();
const hour = new Map<number, TimeRow>();
const traces: Trace[] = [];
const browserSamples: BrowserSample[] = [];
let host: Record<string, unknown> | null = null;
let loop: { p95Ms: number; utilizationPercent: number; observedAt: number } | null = null;
let lastSavedAt: number | null = null;
let writeFailed = false;
let collectorTimer: ReturnType<typeof setInterval> | undefined;
const lag = monitorEventLoopDelay({ resolution: 20 });
let previousUtilization = performance.eventLoopUtilization();

export function performanceEnabled() {
  return process.env.ORBIT_PERFORMANCE_ENABLED === 'true' && process.env.DIGEST_SHADOW_ONLY !== 'true';
}
export function performanceRange(value: unknown): value is Range {
  return typeof value === 'string' && Object.hasOwn(ranges, value);
}
function histogram(): Histogram {
  return { count: 0, errors: 0, histogram: Array(buckets.length + 1).fill(0) };
}
function getRow(map: Map<number, TimeRow>, at: number) {
  const value = map.get(at) ?? { at, routes: {} };
  map.set(at, value);
  return value;
}
function prune(map: Map<number, TimeRow>, before: number) {
  for (const key of map.keys()) if (key < before) map.delete(key);
}

export function recordPerformance(route: string, sample: ApiTiming, requestId: string) {
  if (!performanceEnabled() || !observesOperation(route) || !Number.isFinite(sample.durationMs)) return;
  const bucket = buckets.findIndex(value => sample.durationMs <= value);
  for (const [map, unit] of [[minute, MINUTE], [hour, HOUR]] as const) {
    const row = getRow(map, Math.floor(sample.observedAt / unit) * unit);
    const metric = row.routes[route] ??= histogram();
    metric.count++;
    if (sample.status >= 500) metric.errors++;
    metric.histogram[bucket < 0 ? buckets.length : bucket]++;
  }
  if (sample.durationMs >= 500 || sample.status >= 500 || Math.random() < 0.01) {
    // Stable response ID and controlled measurements only. Exclude operation IDs and accounts.
    const timing = Object.fromEntries(phases.flatMap(name => {
      const value = sample.phases?.[name];
      return typeof value === 'number' && Number.isFinite(value) ? [[name, Math.round(value)]] : [];
    }));
    traces.push({ id: requestId, route, status: sample.status, observedAt: sample.observedAt,
      durationMs: Math.round(sample.durationMs), phases: timing });
    if (traces.length > 120) traces.shift();
  }
}

export function recordBrowserPerformance(input: unknown) {
  if (!performanceEnabled() || !input || typeof input !== 'object' || Array.isArray(input)) return false;
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => key !== 'requestId' && !browserFields.includes(key as BrowserMetric))) return false;
  const value: BrowserSample = { observedAt: Date.now() };
  for (const key of browserFields) {
    if (raw[key] === undefined) continue;
    const number = raw[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 180_000) return false;
    value[key] = Math.round(number);
  }
  if (Object.keys(value).length === 1) return false;
  if (typeof raw.requestId === 'string' && /^[a-f0-9-]{36}$/.test(raw.requestId)) value.requestId = raw.requestId;
  browserSamples.push(value);
  if (browserSamples.length > 40) browserSamples.shift();
  return true;
}

function percentile(value: Histogram, fraction: number) {
  if (!value.count) return null;
  const target = Math.ceil(value.count * fraction);
  let accumulated = 0;
  const index = value.histogram.findIndex(count => ((accumulated += count) >= target));
  return buckets[index] ?? 60_000;
}
function combine(rows: TimeRow[]) {
  const values: Record<string, Histogram> = {};
  for (const row of rows) for (const [route, source] of Object.entries(row.routes)) {
    const value = values[route] ??= histogram();
    value.count += source.count;
    value.errors += source.errors;
    source.histogram.forEach((count, index) => { value.histogram[index] += count; });
  }
  return values;
}
export function performanceOverview(range: Range, now = Date.now()) {
  const map = range === '30d' ? hour : minute;
  const rows = [...map.values()].filter(row => row.at >= now - ranges[range] && row.at <= now).sort((a, b) => a.at - b.at);
  const totals = combine(rows);
  const trendUnit = range === '30d' ? DAY : range === '24h' ? HOUR : range === '1h' ? 5 * MINUTE : MINUTE;
  const trendMap = new Map<number, TimeRow[]>();
  for (const row of rows) {
    const at = Math.floor(row.at / trendUnit) * trendUnit;
    const group = trendMap.get(at) ?? [];
    group.push(row); trendMap.set(at, group);
  }
  return {
    enabled: performanceEnabled(), observedAt: now, lastSavedAt, writeFailed, host, loop,
    process: { uptimeSeconds: Math.floor(process.uptime()), rssBytes: process.memoryUsage.rss() },
    routes: Object.entries(totals).map(([route, value]) => ({ route, count: value.count, errors: value.errors,
      p50: percentile(value, .5), p95: percentile(value, .95), p99: percentile(value, .99) })),
    trend: [...trendMap].map(([at, slice]) => ({ at, ...Object.values(combine(slice)).reduce(
      (total, value) => ({ count: total.count + value.count, errors: total.errors + value.errors }), { count: 0, errors: 0 }) })),
    traces: traces.filter(row => row.observedAt >= now - DAY).slice(-15).reverse(),
    browser: browserSamples.filter(row => row.observedAt >= now - HOUR).slice(-8).reverse(),
  };
}

async function persist() {
  const dir = operationsDirectory();
  const now = Date.now();
  prune(minute, now - DAY);
  prune(hour, now - 30 * DAY);
  const filename = path.join(dir, 'performance.json');
  const temporary = filename + '.pending-' + randomUUID();
  try {
    const value = JSON.stringify({ minute: [...minute.values()], hour: [...hour.values()] });
    if (Buffer.byteLength(value) > 8 * 1024 * 1024) throw new Error('PERFORMANCE_FILE_LIMIT');
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    await fs.writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, filename);
    lastSavedAt = now;
    writeFailed = false;
  } catch {
    writeFailed = true;
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function validRows(value: unknown, earliest: number): TimeRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row && Number.isFinite(row.at) && row.at >= earliest
    && row.routes && Object.entries(row.routes).every(([route, metric]) => {
      const item = metric as Histogram;
      return observesOperation(route) && item && Array.isArray(item.histogram)
        && item.histogram.length === buckets.length + 1 && item.histogram.every(n => Number.isSafeInteger(n) && n >= 0)
        && Number.isSafeInteger(item.count) && Number.isSafeInteger(item.errors) && item.errors >= 0 && item.errors <= item.count;
    }));
}

async function restore() {
  const file = path.join(operationsDirectory(), 'performance.json');
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    const now = Date.now();
    for (const row of validRows(data.minute, now - DAY)) if (!minute.has(row.at)) minute.set(row.at, row);
    for (const row of validRows(data.hour, now - 30 * DAY)) if (!hour.has(row.at)) hour.set(row.at, row);
    lastSavedAt = stat.mtimeMs;
  } catch { /* A fresh or unreadable history does not block startup. */ }
}

let collecting = false;
async function sample() {
  if (collecting) return;
  collecting = true;
  try {
    const state = performance.eventLoopUtilization(previousUtilization);
    previousUtilization = performance.eventLoopUtilization();
    loop = { observedAt: Date.now(), p95Ms: Math.round(lag.percentile(95) / 1000000),
      utilizationPercent: Math.round(state.utilization * 1000) / 10 };
    lag.reset();
    if (lastSavedAt === null || Date.now() - lastSavedAt >= MINUTE) await persist();
    if (process.platform === 'linux') {
      const helper = fileURLToPath(new URL('../scripts/operations/sample-linux-resources.py', import.meta.url));
      host = await new Promise(resolve => execFile('python3', [helper, '--path', operationsDirectory(), '--seconds', '1'],
        { timeout: 5000, maxBuffer: 32768 }, (error, output) => {
          try { resolve(error ? null : JSON.parse(output)); } catch { resolve(null); }
        }));
    }
  } finally { collecting = false; }
}

export function startPerformanceCollection() {
  if (!performanceEnabled() || collectorTimer) return;
  lag.enable();
  void restore().then(() => { if (collectorTimer) void sample(); });
  collectorTimer = setInterval(() => { void sample(); }, 30000);
  collectorTimer.unref();
}
export function stopPerformanceCollection() {
  if (!collectorTimer) return;
  clearInterval(collectorTimer);
  collectorTimer = undefined;
  lag.disable();
}
