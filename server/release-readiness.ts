import { lstatSync, readFileSync } from 'node:fs';
import type { RequestHandler } from 'express';

function packagedCommit(manifestPath: string, version: string): string | null {
  try {
    const stat = lstatSync(manifestPath);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest?.version === version && typeof manifest.commit === 'string' && /^[a-f0-9]{40}$/.test(manifest.commit)
      ? manifest.commit : null;
  } catch {
    // Local and older releases may not have a frozen manifest.
    return null;
  }
}

export function releaseReadiness(input: { version: string; manifestPath: string; checkStore: () => void }): RequestHandler {
  const commit = packagedCommit(input.manifestPath, input.version);
  return (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      input.checkStore();
    } catch {
      res.status(503).json({ status: 'unavailable' });
      return;
    }
    res.json({ status: 'ready', version: input.version, commit });
  };
}
