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
});
