import { afterEach, beforeEach, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexProvider } from './codex';
import { ClaudeCodeProvider } from './claude-code';
import { resetPricingState, setRemotePricingForTest } from '../models/pricing-resolver';

let root: string;
const originalDir = process.env['TOKENLEAK_USAGE_CACHE_DIR'];
const originalEnabled = process.env['TOKENLEAK_USAGE_CACHE'];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tokenleak-cached-provider-'));
  process.env['TOKENLEAK_USAGE_CACHE_DIR'] = join(root, 'cache');
  delete process.env['TOKENLEAK_USAGE_CACHE'];
});
afterEach(() => {
  if (originalDir === undefined) delete process.env['TOKENLEAK_USAGE_CACHE_DIR'];
  else process.env['TOKENLEAK_USAGE_CACHE_DIR'] = originalDir;
  if (originalEnabled === undefined) delete process.env['TOKENLEAK_USAGE_CACHE'];
  else process.env['TOKENLEAK_USAGE_CACHE'] = originalEnabled;
  resetPricingState();
  rmSync(root, { recursive: true, force: true });
});
const range = { since: '2026-01-01', until: '2026-01-02' };
for (const Provider of [CodexProvider, ClaudeCodeProvider]) {
  test(`${Provider.name}: cold/warm/uncached parity, range changes, pricing and appends`, async () => {
    const source = join(root, 'source');
    mkdirSync(source);
    const file = join(source, 'session.jsonl');
    const record = (day: string, input: number) =>
      Provider === CodexProvider
        ? {
            type: 'response',
            timestamp: `${day}T12:00:00Z`,
            model: 'gpt-4o',
            usage: { input_tokens: input, output_tokens: 10, total_tokens: input + 10 },
          }
        : {
            type: 'assistant',
            timestamp: `${day}T12:00:00Z`,
            message: {
              id: 'same-id',
              model: 'gpt-4o',
              usage: { input_tokens: input, output_tokens: 10 },
            },
          };
    writeFileSync(
      file,
      [record(range.since, 100), record(range.until, 200)]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n{bad}\n',
    );
    const provider = new Provider(source);
    const cold = await provider.load(range);
    expect(await new Provider(source).load(range)).toEqual(cold);
    process.env['TOKENLEAK_USAGE_CACHE'] = '0';
    expect(await provider.load(range)).toEqual(cold);
    delete process.env['TOKENLEAK_USAGE_CACHE'];
    const narrow = await provider.load({ since: range.since, until: range.since });
    // Claude must filter before deduplication, even when the same ID crosses days.
    expect(narrow.totalTokens).toBe(110);
    expect(narrow.warnings?.some((w) => w.kind === 'parse')).toBe(true);
    setRemotePricingForTest({ 'gpt-4o': { input: 10, output: 20, cacheRead: 1, cacheWrite: 10 } });
    const repriced = await provider.load(range);
    expect(repriced.totalCost).toBeGreaterThan(cold.totalCost);
    expect(repriced.totalTokens).toBe(cold.totalTokens);
    appendFileSync(file, JSON.stringify(record(range.until, 300)) + '\n');
    const updated = await provider.load(range);
    expect(updated.totalTokens).toBeGreaterThan(cold.totalTokens);
    process.env['TOKENLEAK_USAGE_CACHE'] = '0';
    expect(await provider.load(range)).toEqual(updated);
  });
}
