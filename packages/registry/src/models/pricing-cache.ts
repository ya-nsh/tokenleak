import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RemotePricingEntry } from './litellm';

const CACHE_FILENAME = 'pricing.json';
const CACHE_TTL_MS = 86_400_000; // 24 hours
// v2: rows carry `firstParty`; v1 merged reseller markups over vendor prices.
const CACHE_VERSION = 2;

export interface PricingCacheEnvelope {
  version: number;
  fetchedAt: number;
  data: Record<string, RemotePricingEntry>;
}

function defaultCacheDir(): string {
  try {
    const home = homedir();
    return join(home, '.cache', 'tokenleak');
  } catch {
    return join(tmpdir(), 'tokenleak-cache');
  }
}

function cachePath(cacheDir?: string): string {
  return join(cacheDir ?? defaultCacheDir(), CACHE_FILENAME);
}

export function isCacheValid(envelope: PricingCacheEnvelope): boolean {
  const age = Date.now() - envelope.fetchedAt;
  return envelope.version === CACHE_VERSION && age >= 0 && age < CACHE_TTL_MS;
}

function isRate(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRemotePricingEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    ['input', 'output', 'cacheRead', 'cacheWrite'].every((key) => isRate(entry[key])) &&
    (entry['cacheWrite1h'] === undefined || isRate(entry['cacheWrite1h'])) &&
    typeof entry['firstParty'] === 'boolean'
  );
}

function readEnvelope(cacheDir?: string): PricingCacheEnvelope | null {
  const path = cachePath(cacheDir);
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as PricingCacheEnvelope;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.version !== CACHE_VERSION ||
      typeof parsed.fetchedAt !== 'number' ||
      typeof parsed.data !== 'object' ||
      parsed.data === null ||
      !Object.values(parsed.data).every(isRemotePricingEntry)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Read the pricing cache. Returns the envelope if valid (within TTL),
 * otherwise null.
 */
export function readPricingCache(
  cacheDir?: string,
): PricingCacheEnvelope | null {
  const envelope = readEnvelope(cacheDir);
  if (envelope && isCacheValid(envelope)) return envelope;
  return null;
}

/**
 * Read the pricing cache regardless of TTL. Returns the envelope if the file
 * exists and is valid, even if stale.
 */
export function readStalePricingCache(
  cacheDir?: string,
): PricingCacheEnvelope | null {
  return readEnvelope(cacheDir);
}

/**
 * Write pricing data to the disk cache atomically (write tmp + rename).
 */
export function writePricingCache(
  data: Record<string, RemotePricingEntry>,
  cacheDir?: string,
): void {
  const dir = cacheDir ?? defaultCacheDir();
  const path = join(dir, CACHE_FILENAME);
  const tmpPath = `${path}.tmp`;

  try {
    mkdirSync(dir, { recursive: true });

    const envelope: PricingCacheEnvelope = {
      version: CACHE_VERSION,
      fetchedAt: Date.now(),
      data,
    };

    writeFileSync(tmpPath, JSON.stringify(envelope), 'utf-8');
    renameSync(tmpPath, path);
  } catch {
    // Best-effort — if caching fails, pricing still works via remote/hardcoded
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}
