/**
 * Bun test preload: keeps every package's tests away from the developer's
 * real caches, pricing overrides, and the network.
 *
 * Without it, provider tests wrote one usage-cache file per temp fixture root
 * into ~/.cache/tokenleak/usage, and pricing tests read the user's own
 * override file and LiteLLM cache.
 */
import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tokenleak-test-'));

process.env['TOKENLEAK_CACHE_DIR'] ??= join(root, 'cache');
process.env['TOKENLEAK_PRICING_FILE'] ??= join(root, 'no-pricing-overrides.json');
process.env['TOKENLEAK_OFFLINE'] ??= '1';

// bun runs preload-registered lifecycle hooks once per test run; the exit
// listener is a fallback for runs that end early.
const cleanup = () => rmSync(root, { recursive: true, force: true });
afterAll(cleanup);
process.on('exit', cleanup);
