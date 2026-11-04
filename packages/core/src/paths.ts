import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * How long a cache written by another Tokenleak version must go unused before
 * this version deletes it. Two installed versions (a global release and a
 * local build, say) then keep each other's caches warm, and an upgrade still
 * cleans up after itself.
 */
export const SUPERSEDED_CACHE_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1_000;

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
