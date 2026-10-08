import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function operationsDirectory(): string {
  return path.resolve(process.env.ORBIT_OPERATIONS_DIR || path.join(process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data'), 'operations'));
}
export function readOperations<T>(name: 'deployments.json' | 'status.json' | 'jobs.json', fallback: T): T {
  try {
    const file = path.join(operationsDirectory(), name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch { return fallback; }
}
export function writeJobs(value: unknown): void {
  const dir = operationsDirectory();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `jobs.json.${process.pid}.pending`);
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temp, path.join(dir, 'jobs.json'));
  } catch { /* Monitoring must not change scheduler behavior. */ }
}
export function diagnosticCode(value: unknown): string {
  return typeof value === 'string' && /^(?:[A-Z][A-Z0-9_]{0,79}|[a-z][a-z0-9_]{0,79}|(?:messaging|app)\/[a-z-]{1,80})$/.test(value) && !/(?:secret|password|authorization)/i.test(value) ? value : 'UNCLASSIFIED_ERROR';
}
