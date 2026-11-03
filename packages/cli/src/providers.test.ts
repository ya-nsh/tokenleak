import { describe, expect, test } from 'bun:test';
import { normalizeProviderToken } from './providers';

describe('normalizeProviderToken', () => {
  test('resolves aliases, case and spacing', () => {
    expect(normalizeProviderToken(' Claude ')).toBe('claude-code');
    expect(normalizeProviderToken('open code')).toBe('open-code');
    expect(normalizeProviderToken('openai')).toBe('codex');
  });

  test('passes unknown names through unchanged', () => {
    expect(normalizeProviderToken('my-provider')).toBe('my-provider');
  });

  test.each(['constructor', 'tostring', '__proto__', 'hasownproperty'])(
    'treats %p as a provider name, not an Object.prototype member',
    (token) => {
      expect(normalizeProviderToken(token)).toBe(token);
    },
  );
});
