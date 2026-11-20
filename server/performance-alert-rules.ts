import type { RequestPhases } from './request-timing.js';

export interface ApiTiming {
  durationMs: number;
  status: number;
  operationId: string;
  observedAt: number;
  phases?: RequestPhases;
}

const WINDOW_MS = 5 * 60_000;
const MIN_STATISTICAL_SAMPLES = 30;
const MIN_REPEATED_SLOW_OPERATIONS = 3;

function summarize(samples: ApiTiming[]) {
  const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  const failures = samples.filter(sample => sample.status >= 500).length;
  const percentile = (fraction: number) => durations.length ? Math.round(durations[Math.ceil(durations.length * fraction) - 1]) : null;
  return {
    count: samples.length,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    errorRate: samples.length ? failures / samples.length : null,
  };
}

export function evaluatePerformanceAlert(samples: ApiTiming[], at: number, openedAt?: number) {
  const recent = samples.filter(sample => sample.observedAt > at - 2 * WINDOW_MS && sample.observedAt <= at);
  const current = summarize(recent.filter(sample => sample.observedAt > at - WINDOW_MS));
  const preceding = summarize(recent.filter(sample => sample.observedAt <= at - WINDOW_MS));
  const isHighLatency = (window: typeof current) => window.count >= MIN_STATISTICAL_SAMPLES
    && ((window.p95Ms ?? 0) > 1500 || (window.errorRate ?? 0) >= 0.05);
  const slowerOperations = new Set(recent.filter(sample => sample.durationMs >= 2000).map(sample => sample.operationId)).size;
  const statistical = isHighLatency(current) && isHighLatency(preceding);
  const repeated = slowerOperations >= MIN_REPEATED_SLOW_OPERATIONS;
  const healthySinceOpen = new Set(recent.filter(sample => openedAt !== undefined && sample.observedAt > openedAt
    && sample.durationMs < 1500 && sample.status < 500).map(sample => sample.operationId)).size;
  return {
    active: statistical || repeated,
    recovered: !statistical && !repeated && healthySinceOpen >= 3,
    rule: statistical ? 'STATISTICAL_API' : 'REPEATED_SLOW_OPERATION',
    metrics: { ...current, slowOperations: slowerOperations },
  } as const;
}
