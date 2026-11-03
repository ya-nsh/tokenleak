import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexConfiguredTier } from './codex-config';

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function configWith(toml: string): string {
  dir = mkdtempSync(join(tmpdir(), 'tokenleak-codex-config-'));
  const path = join(dir, 'config.toml');
  writeFileSync(path, toml);
  return path;
}

describe('readCodexConfiguredTier', () => {
  it('reads the top-level service_tier', () => {
    expect(readCodexConfiguredTier(configWith('model = "gpt-5.5"\nservice_tier = "default"\n'))).toBe('default');
  });

  it('normalizes priority to fast and ignores case', () => {
    expect(readCodexConfiguredTier(configWith('service_tier = "Priority"\n'))).toBe('fast');
  });

  it('prefers the active profile, falling back to the top level', () => {
    const toml = [
      'profile = "work"',
      'service_tier = "default"',
      '[profiles.work]',
      'service_tier = "flex"',
      '[profiles.home]',
      'service_tier = "fast"',
    ].join('\n');
    expect(readCodexConfiguredTier(configWith(toml))).toBe('flex');
    expect(readCodexConfiguredTier(configWith('profile = "home"\nservice_tier = "default"\n[profiles.home]\nmodel = "x"\n'))).toBe(
      'default',
    );
    expect(readCodexConfiguredTier(configWith('profile = "missing"\nservice_tier = "fast"\n'))).toBe('fast');
  });

  it('ignores unrelated tables such as project trust entries', () => {
    const toml = 'service_tier = "default"\n[projects."/Users/me/app"]\ntrust_level = "trusted"\n';
    expect(readCodexConfiguredTier(configWith(toml))).toBe('default');
  });

  it('returns undefined when no recognizable tier is configured', () => {
    expect(readCodexConfiguredTier(configWith('model = "gpt-5.5"\n'))).toBeUndefined();
    expect(readCodexConfiguredTier(configWith('service_tier = "turbo-max"\n'))).toBeUndefined();
    expect(readCodexConfiguredTier(configWith('service_tier = 3\n'))).toBeUndefined();
  });

  it('returns undefined for a missing or malformed file', () => {
    expect(readCodexConfiguredTier(join(tmpdir(), 'tokenleak-no-such-dir', 'config.toml'))).toBeUndefined();
    expect(readCodexConfiguredTier(configWith('service_tier = "default\n[[broken'))).toBeUndefined();
  });
});
