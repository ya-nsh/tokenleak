import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from './index';

const PACKAGES_DIR = join(import.meta.dir, '..', '..');

describe('core', () => {
  it('exports a version string', () => {
    expect(VERSION).toBe('2.4.0');
  });

  it('version is a valid semver format', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('every workspace package is released at VERSION', () => {
    const versions = readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try {
          const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, entry.name, 'package.json'), 'utf8')) as {
            name?: unknown;
            version?: unknown;
          };
          return [[String(pkg.name), pkg.version] as const];
        } catch {
          return [];
        }
      });
    expect(versions.length).toBeGreaterThanOrEqual(6);
    expect(versions.filter(([, version]) => version !== VERSION)).toEqual([]);
  });
});
