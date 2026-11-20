import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

type Phase = 'sqlMs' | 'exportMs' | 'writeMs' | 'syncMs';
export type RequestPhases = Partial<Record<Phase, number>>;
export const requestPhases = new AsyncLocalStorage<RequestPhases>();

export function measureRequestPhase<T>(phase: Phase, operation: () => T): T {
  const phases = requestPhases.getStore();
  if (!phases) return operation();
  const start = performance.now();
  try {
    return operation();
  } finally {
    phases[phase] = (phases[phase] ?? 0) + performance.now() - start;
  }
}
