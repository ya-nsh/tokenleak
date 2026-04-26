import { describe, expect, it } from 'bun:test';
import type { DateRange, ProviderData, ProviderColors } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import { loadCompareTokenleakData, loadTokenleakData } from './data-loader';
import { TokenleakError } from './errors';

const COLORS: ProviderColors = {
  primary: '#000000',
  secondary: '#111111',
  gradient: ['#000000', '#111111'],
};
const RANGE: DateRange = {
  since: '2026-03-01',
  until: '2026-03-14',
};

function createProviderData(name: string): ProviderData {
  return {
    provider: name,
    displayName: name,
    daily: [],
    totalTokens: 0,
    totalCost: 0,
    colors: COLORS,
    events: [],
  };
}

function createProvider(
  name: string,
  load: (range: DateRange) => Promise<ProviderData>,
): IProvider {
  return {
    name,
    displayName: name,
    colors: COLORS,
    async isAvailable() {
      return true;
    },
    load,
  };
}

describe('loadTokenleakData', () => {
  it('throws when every provider load fails', async () => {
    const providers: IProvider[] = [
      createProvider('claude-code', async () => {
        throw new Error('boom');
      }),
      createProvider('codex', async () => {
        throw new Error('boom');
      }),
    ];

    await expect(loadTokenleakData(providers, RANGE)).rejects.toThrow(
      new TokenleakError('No provider data found'),
    );
  });

  it('keeps successful providers even if one loader fails', async () => {
    const output = await loadTokenleakData([
      createProvider('claude-code', async () => createProviderData('claude-code')),
      createProvider('codex', async () => {
        throw new Error('boom');
      }),
    ], RANGE);

    expect(output.providers).toHaveLength(2);
    expect(output.providers[0]?.provider).toBe('claude-code');
    expect(output.providers[1]?.provider).toBe('codex');
    expect(output.providers[1]?.warnings).toEqual([
      { kind: 'provider-load', file: 'codex', count: 1 },
    ]);
    expect(output.dateRange).toEqual(RANGE);
    expect(output.more?.cacheRoi).toBeDefined();
  });

  it('builds compare output with previous in periodA and current in periodB', async () => {
    const result = await loadCompareTokenleakData([
      createProvider('claude-code', async (range) => ({
        ...createProviderData('claude-code'),
        daily: [{
          date: range.until,
          inputTokens: range.since.startsWith('2026-02') ? 200 : 400,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: range.since.startsWith('2026-02') ? 200 : 400,
          cost: range.since.startsWith('2026-02') ? 0.2 : 0.4,
          models: [{
            model: 'claude-sonnet-4',
            inputTokens: range.since.startsWith('2026-02') ? 200 : 400,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: range.since.startsWith('2026-02') ? 200 : 400,
            cost: range.since.startsWith('2026-02') ? 0.2 : 0.4,
          }],
        }],
        totalTokens: range.since.startsWith('2026-02') ? 200 : 400,
        totalCost: range.since.startsWith('2026-02') ? 0.2 : 0.4,
      })),
    ], RANGE, 'auto');

    expect(result.compareOutput.periodA.range.until).toBe('2026-02-28');
    expect(result.compareOutput.periodB.range.until).toBe('2026-03-14');
    expect(result.compareOutput.deltas.tokens).toBe(200);
    expect(result.output.more?.compare?.previousStats.totalTokens).toBe(200);
  });
});
