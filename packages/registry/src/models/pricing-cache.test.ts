import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isCacheValid,
  readPricingCache,
  readStalePricingCache,
  writePricingCache,
} from './pricing-cache';
import type { PricingCacheEnvelope } from './pricing-cache';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `tokenleak-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  tmpDirs = [];
});

function withTmpDir(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

describe('writePricingCache + readPricingCache', () => {
  test('round-trips correctly', () => {
    const dir = withTmpDir();
    const data = {
      'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
    };

    writePricingCache(data, dir);
    const cached = readPricingCache(dir);

    expect(cached).not.toBeNull();
    expect(cached!.data['gpt-4o']).toEqual(data['gpt-4o']);
    expect(cached!.version).toBe(1);
    expect(typeof cached!.fetchedAt).toBe('number');
  });

  test('does not leave .tmp file behind on success', () => {
    const dir = withTmpDir();
    writePricingCache({ model: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }, dir);
    expect(existsSync(join(dir, 'pricing.json.tmp'))).toBe(false);
    expect(existsSync(join(dir, 'pricing.json'))).toBe(true);
  });
});

describe('isCacheValid', () => {
  test('returns true for fresh cache', () => {
    const envelope: PricingCacheEnvelope = {
      version: 1,
      fetchedAt: Date.now(),
      data: {},
    };
    expect(isCacheValid(envelope)).toBe(true);
  });

  test('returns false for expired cache', () => {
    const envelope: PricingCacheEnvelope = {
      version: 1,
      fetchedAt: Date.now() - 3_700_000, // > 1 hour ago
      data: {},
    };
    expect(isCacheValid(envelope)).toBe(false);
  });

  test('returns false for wrong version', () => {
    const envelope: PricingCacheEnvelope = {
      version: 99,
      fetchedAt: Date.now(),
      data: {},
    };
    expect(isCacheValid(envelope)).toBe(false);
  });
});

describe('readPricingCache', () => {
  test('returns null for missing file', () => {
    const dir = withTmpDir();
    expect(readPricingCache(dir)).toBeNull();
  });

  test('returns null for corrupt JSON', () => {
    const dir = withTmpDir();
    writeFileSync(join(dir, 'pricing.json'), 'not json at all', 'utf-8');
    expect(readPricingCache(dir)).toBeNull();
  });

  test('returns null for expired cache', () => {
    const dir = withTmpDir();
    const envelope = {
      version: 1,
      fetchedAt: Date.now() - 4_000_000,
      data: { m: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
    };
    writeFileSync(join(dir, 'pricing.json'), JSON.stringify(envelope), 'utf-8');
    expect(readPricingCache(dir)).toBeNull();
  });
});

describe('readStalePricingCache', () => {
  test('returns data regardless of age', () => {
    const dir = withTmpDir();
    const data = { m: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } };
    const envelope = {
      version: 1,
      fetchedAt: Date.now() - 999_999_999,
      data,
    };
    writeFileSync(join(dir, 'pricing.json'), JSON.stringify(envelope), 'utf-8');
    const result = readStalePricingCache(dir);
    expect(result).not.toBeNull();
    expect(result!['m']).toEqual(data.m);
  });

  test('returns null for missing file', () => {
    const dir = withTmpDir();
    expect(readStalePricingCache(dir)).toBeNull();
  });
});
