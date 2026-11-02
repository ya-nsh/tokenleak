import { describe, expect, test } from 'bun:test';
import { parseLiteLLMData } from './litellm';

describe('parseLiteLLMData', () => {
  test('converts per-token pricing to per-million-token pricing', () => {
    const raw = {
      'gpt-4o': {
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.00001,
        cache_read_input_token_cost: 0.00000125,
        cache_creation_input_token_cost: 0.0000025,
      },
    };

    const result = parseLiteLLMData(raw);
    expect(result['gpt-4o']).toEqual({
      input: 2.5,
      output: 10,
      cacheRead: 1.25,
      cacheWrite: 2.5,
      firstParty: false,
    });
  });

  test('stores entries under full, unprefixed, and normalized keys', () => {
    const raw = {
      'anthropic/claude-3-opus-20240229': {
        input_cost_per_token: 0.000015,
        output_cost_per_token: 0.000075,
      },
    };

    const result = parseLiteLLMData(raw);

    // Full key
    expect(result['anthropic/claude-3-opus-20240229']).toBeDefined();
    // Unprefixed key
    expect(result['claude-3-opus-20240229']).toBeDefined();
    // Normalized key (date suffix stripped)
    expect(result['claude-3-opus']).toBeDefined();

    // All should have the same pricing
    expect(result['claude-3-opus']!.input).toBeCloseTo(15.0);
    expect(result['claude-3-opus']!.output).toBeCloseTo(75.0);
  });

  test('defaults cache token fields to 0 when absent', () => {
    const raw = {
      'some-model': {
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
      },
    };

    const result = parseLiteLLMData(raw);
    expect(result['some-model']!.cacheRead).toBe(0);
    expect(result['some-model']!.cacheWrite).toBe(0);
  });

  test('skips entries without input_cost_per_token', () => {
    const raw = {
      'metadata-only': {
        max_tokens: 4096,
        litellm_provider: 'openai',
      },
    };

    const result = parseLiteLLMData(raw);
    expect(result['metadata-only']).toBeUndefined();
  });

  test('skips entries with zero input cost', () => {
    const raw = {
      'free-model': {
        input_cost_per_token: 0,
        output_cost_per_token: 0,
      },
    };

    const result = parseLiteLLMData(raw);
    expect(result['free-model']).toBeUndefined();
  });

  test('skips null and non-object entries', () => {
    const raw = {
      'null-entry': null,
      'string-entry': 'not an object',
      'number-entry': 42,
    };

    const result = parseLiteLLMData(raw as Record<string, unknown>);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('returns empty map for empty input', () => {
    const result = parseLiteLLMData({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('handles entries without provider prefix', () => {
    const raw = {
      // LiteLLM uses YYYY-MM-DD format which does NOT match the -YYYYMMDD
      // normalizer — normalized key equals original key
      'gpt-4o-2024-08-06': {
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.00001,
      },
    };

    const result = parseLiteLLMData(raw);
    expect(result['gpt-4o-2024-08-06']).toBeDefined();
    expect(result['gpt-4o-2024-08-06']!.input).toBeCloseTo(2.5);
  });

  test('handles entries with YYYYMMDD date suffix from API providers', () => {
    const raw = {
      'claude-sonnet-4-20250514': {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };

    const result = parseLiteLLMData(raw);
    // Original key
    expect(result['claude-sonnet-4-20250514']).toBeDefined();
    // Normalized key (date suffix stripped)
    expect(result['claude-sonnet-4']).toBeDefined();
    expect(result['claude-sonnet-4']!.input).toBeCloseTo(3.0);
  });

  test('marks bare rows from the model vendor as first-party', () => {
    const result = parseLiteLLMData({
      'claude-opus-5-5': {
        litellm_provider: 'anthropic',
        input_cost_per_token: 4e-6,
        output_cost_per_token: 2e-5,
        cache_read_input_token_cost: 2e-7,
        cache_creation_input_token_cost: 5e-6,
        cache_creation_input_token_cost_above_1hr: 8e-6,
      },
    });
    const row = result['claude-opus-5-5']!;
    expect(row.input).toBeCloseTo(4);
    expect(row.output).toBeCloseTo(20);
    expect(row.cacheRead).toBeCloseTo(0.2);
    expect(row.cacheWrite).toBeCloseTo(5);
    expect(row.cacheWrite1h).toBeCloseTo(8);
    expect(row.firstParty).toBe(true);
  });

  test('a reseller row never overwrites the vendor price, whatever the file order', () => {
    const vendor = {
      litellm_provider: 'anthropic',
      input_cost_per_token: 5e-6,
      output_cost_per_token: 2.5e-5,
    };
    const reseller = {
      litellm_provider: 'kyma',
      input_cost_per_token: 6.75e-6,
      output_cost_per_token: 3.375e-5,
    };
    const resellerFirst = parseLiteLLMData({ 'kyma/claude-opus-5': reseller, 'claude-opus-5': vendor });
    const vendorFirst = parseLiteLLMData({ 'claude-opus-5': vendor, 'kyma/claude-opus-5': reseller });
    for (const result of [resellerFirst, vendorFirst]) {
      expect(result['claude-opus-5']!.input).toBeCloseTo(5);
      expect(result['claude-opus-5']!.firstParty).toBe(true);
      // The reseller row stays addressable under its own key.
      expect(result['kyma/claude-opus-5']!.input).toBeCloseTo(6.75);
      expect(result['kyma/claude-opus-5']!.firstParty).toBe(false);
    }
  });

  test('a vendor-prefixed row beats a bare third-party row', () => {
    const result = parseLiteLLMData({
      'mystery-model': { litellm_provider: 'novita', input_cost_per_token: 9e-6, output_cost_per_token: 9e-6 },
      'openai/mystery-model': { litellm_provider: 'openai', input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
    });
    expect(result['mystery-model']!.input).toBeCloseTo(1);
    expect(result['mystery-model']!.firstParty).toBe(true);
  });

  test('reseller-only models stay available but are never first-party', () => {
    const result = parseLiteLLMData({
      'azure_ai/gpt-6.1-sol': { litellm_provider: 'azure_ai', input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 },
    });
    expect(result['gpt-6.1-sol']!.firstParty).toBe(false);
  });

  test('skips rows with negative output cost', () => {
    const result = parseLiteLLMData({
      broken: { input_cost_per_token: 1e-6, output_cost_per_token: -1 },
    });
    expect(result['broken']).toBeUndefined();
  });
});

describe('fetchLiteLLMPricing', () => {
  test('never touches the network when TOKENLEAK_OFFLINE=1', async () => {
    const { fetchLiteLLMPricing } = await import('./litellm');
    const previous = process.env['TOKENLEAK_OFFLINE'];
    process.env['TOKENLEAK_OFFLINE'] = '1';
    try {
      await expect(fetchLiteLLMPricing()).rejects.toThrow('TOKENLEAK_OFFLINE=1');
    } finally {
      if (previous === undefined) delete process.env['TOKENLEAK_OFFLINE'];
      else process.env['TOKENLEAK_OFFLINE'] = previous;
    }
  });
});
