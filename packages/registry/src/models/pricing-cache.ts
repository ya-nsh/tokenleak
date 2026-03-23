import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelPricing } from './pricing';

const CACHE_FILENAME = 'pricing.json';
const CACHE_TTL_MS = 3_600_000; // 1 hour
const CACHE_VERSION = 1;

export interface PricingCacheEnvelope {
  version: number;
  fetchedAt: number;
  data: Record<string, ModelPricing>;
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
  return (
    envelope.version === CACHE_VERSION &&
    Date.now() - envelope.fetchedAt < CACHE_TTL_MS
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
      typeof parsed.version !== 'number' ||
      typeof parsed.fetchedAt !== 'number' ||
      typeof parsed.data !== 'object'
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
 * Read the pricing cache regardless of TTL. Returns data if the file exists
 * and is parseable, even if stale.
 */
export function readStalePricingCache(
  cacheDir?: string,
): Record<string, ModelPricing> | null {
  const envelope = readEnvelope(cacheDir);
  return envelope?.data ?? null;
}

/**
 * Write pricing data to the disk cache atomically (write tmp + rename).
 */
export function writePricingCache(
  data: Record<string, ModelPricing>,
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
