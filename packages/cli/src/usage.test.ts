import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuotaClient } from '@tokenleak/registry';
import { parseUsageArgs, runUsage } from './usage';
test('quota flags, aliases and deduplication', () => {
  expect(
    parseUsageArgs(['--json', '--provider', 'claude-code,codex,codex', '--refresh']),
  ).toMatchObject({ format: 'json', providers: ['claude', 'codex'], refresh: true });
  expect(parseUsageArgs(['--help']).help).toBe(true);
});
test('rejects unsupported providers, dates, unknown formats and missing arguments', () => {
  for (const args of [
    ['--provider', 'cursor'],
    ['--provider', ''],
    ['--days', '7'],
    ['--format', 'png'],
    ['--output'],
    ['--provider', 'claude,'],
  ])
    expect(() => parseUsageArgs(args)).toThrow();
});
test('JSON output works without any historical logs and preserves per-provider failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quota-cli-'));
  try {
    const client = new QuotaClient({
      credential: async () => null,
      fetch: (async () => {
        throw new Error('must not fetch');
      }) as typeof fetch,
      now: () => 0,
    });
    const path = join(dir, 'result.json');
    await runUsage(['--json', '--provider', 'codex', '--output', path], client);
    const result = JSON.parse(await readFile(path, 'utf8'));
    expect(result.schemaVersion).toBe(1);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].status).toBe('not-configured');
    await runUsage(['--provider', 'claude', '-o', path], client);
    expect(await readFile(path, 'utf8')).toContain('SUBSCRIPTION QUOTAS');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
