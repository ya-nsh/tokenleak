import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Root directory for every Tokenleak cache (pricing, ingested usage, TUI
 * snapshots). `TOKENLEAK_CACHE_DIR` relocates all of them at once.
 */
export function getTokenleakCacheDir(): string {
  const explicit = process.env['TOKENLEAK_CACHE_DIR'];
  if (explicit && explicit.trim().length > 0) return explicit;
  try {
    return join(homedir(), '.cache', 'tokenleak');
  } catch {
    return join(tmpdir(), 'tokenleak-cache');
  }
}
