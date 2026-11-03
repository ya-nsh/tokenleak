import { describe, expect, test } from 'bun:test';
import { filterTuiData, isFilterActive, providerForModel } from './filter';
import { makeEvents, makeProvider, makeTuiData } from './__fixtures__/usage';

const TODAY = '2026-11-03';

describe('isFilterActive', () => {
  test('is true only with a provider or model', () => {
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive(null)).toBe(false);
    expect(isFilterActive({ provider: 'codex' })).toBe(true);
    expect(isFilterActive({ model: 'm' })).toBe(true);
  });
});

describe('providerForModel', () => {
  test('keeps only that model in days, events and totals', () => {
    const provider = makeProvider('claude-code', 'Claude Code', makeEvents('claude-code', TODAY, 3));
    const narrowed = providerForModel(provider, 'claude-haiku-5-5');
    expect(narrowed.daily.every((day) => day.models.every((m) => m.model === 'claude-haiku-5-5'))).toBe(true);
    expect(narrowed.events?.every((event) => event.model === 'claude-haiku-5-5')).toBe(true);
    const eventCost = narrowed.events!.reduce((sum, event) => sum + event.cost, 0);
    expect(narrowed.totalCost).toBeCloseTo(eventCost);
    expect(narrowed.daily[0]!.cost).toBeCloseTo(narrowed.daily[0]!.models[0]!.cost);
  });

  test('a model the provider never used leaves it empty', () => {
    const provider = makeProvider('codex', 'Codex', makeEvents('codex', TODAY, 2));
    const narrowed = providerForModel(provider, 'nope');
    expect(narrowed.daily).toEqual([]);
    expect(narrowed.events).toEqual([]);
    expect(narrowed.totalCost).toBe(0);
  });
});

describe('filterTuiData', () => {
  test('no filter returns the same data', () => {
    const data = makeTuiData(TODAY);
    expect(filterTuiData(data, {}, TODAY)).toBe(data);
  });

  test('a provider filter rebuilds every window from that provider only', () => {
    const data = makeTuiData(TODAY);
    const codex = filterTuiData(data, { provider: 'codex' }, TODAY);
    expect(codex.providers.map((p) => p.provider)).toEqual(['codex']);
    const codexCost = data.providers.find((p) => p.provider === 'codex')!.totalCost;
    expect(codex.windows.at(-1)!.stats.totalCost).toBeCloseTo(codexCost);
    expect(codex.windows.at(-1)!.dateRange.since).toBe('2026-10-30');
  });

  test('provider and model filters combine', () => {
    const data = makeTuiData(TODAY);
    const both = filterTuiData(data, { provider: 'claude-code', model: 'claude-sonnet-5-5' }, TODAY);
    expect(both.providers).toHaveLength(1);
    expect(both.mergedDaily.every((day) => day.models.every((m) => m.model === 'claude-sonnet-5-5'))).toBe(true);
  });

  test('a filter matching nothing yields empty data rather than throwing', () => {
    const empty = filterTuiData(makeTuiData(TODAY), { model: 'nope' }, TODAY);
    expect(empty.providers).toEqual([]);
    expect(empty.windows).toEqual([]);
  });
});
