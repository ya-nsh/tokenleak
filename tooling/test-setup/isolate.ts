/**
 * Bun test preload: keeps every package's tests away from the developer's
 * real caches, pricing overrides, and the network.
 *
 * Without it, provider tests wrote one usage-cache file per temp fixture root
 * into ~/.cache/tokenleak/usage, and pricing tests read the user's own
 * override file and LiteLLM cache.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tokenleak-test-'));

process.env['TOKENLEAK_CACHE_DIR'] ??= join(root, 'cache');
process.env['TOKENLEAK_PRICING_FILE'] ??= join(root, 'no-pricing-overrides.json');
process.env['TOKENLEAK_OFFLINE'] ??= '1';

process.on('exit', () => {
  rmSync(root, { recursive: true, force: true });
});
