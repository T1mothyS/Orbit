import { AsyncLocalStorage } from 'node:async_hooks';
import { readOperations, writeJobs, diagnosticCode, operationsDirectory } from '../operations-state.js';
export interface JobOutcome { status: 'success' | 'skipped' | 'failed'; reason?: string }
export interface JobStatus { name: string; lastStartedAt: string; lastFinishedAt?: string; lastSuccessAt?: string; lastFailureAt?: string; lastSkippedAt?: string; status: 'running' | JobOutcome['status']; reason?: string }
const scope = new AsyncLocalStorage<{ failed: boolean; reason?: string }>();
let jobs: Record<string, JobStatus> | undefined;
let directory = '';
const active = new Map<string,symbol>();
export function observeJobLog(level: string, data: unknown) {
  const current = scope.getStore();
  if (!current || !data || typeof data !== 'object') return;
  const detail = data as Record<string, unknown>;
  if (level === 'error' || level === 'warn' && (detail.error || detail.errorCode)) {
    current.failed = true;
    current.reason = diagnosticCode(detail.errorCode || detail.event || 'JOB_REPORTED_ERROR');
  }
}
export async function observeJob(name: string, run: () => void | JobOutcome | Promise<void | JobOutcome>): Promise<void> {
  if(directory !== operationsDirectory()) {directory = operationsDirectory(); jobs = undefined;}
  if(!jobs) { const saved=readOperations<unknown>('jobs.json',{}); jobs=saved && typeof saved==='object' && !Array.isArray(saved) ? saved as Record<string,JobStatus> : {}; }
  const started = new Date().toISOString();
  const token=Symbol(name);active.set(name,token);
  jobs[name] = { ...jobs[name], name, lastStartedAt: started, status: 'running' };
  writeJobs(jobs);
  const current = { failed: false, reason: undefined as string | undefined };
  let outcome: JobOutcome = { status: 'success' };
  try {
    const result = await scope.run(current, run);
    if (result) outcome = result;
    if (current.failed) outcome = { status: 'failed', reason: current.reason };
  } catch (error) { outcome = { status: 'failed', reason: diagnosticCode((error as { code?: string })?.code) }; throw error; }
  finally {
    const at = new Date().toISOString();
    if (active.get(name) === token) {
      active.delete(name);
      jobs[name] = { ...jobs[name], status: outcome.status, reason: outcome.reason, lastFinishedAt: at,
        ...(outcome.status === 'success' ? { lastSuccessAt: at } : outcome.status === 'failed' ? { lastFailureAt: at } : { lastSkippedAt: at }) };
      writeJobs(jobs);
    }
  }
}
