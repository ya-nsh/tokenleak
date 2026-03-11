import { describe, it, expect } from 'bun:test';
import type { ProviderColors, ProviderData, DateRange } from '@tokenleak/core';
import type { IProvider } from './provider';
import { ProviderRegistry } from './registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_COLORS: ProviderColors = {
  primary: '#6B5CE7',
  secondary: '#8B7AEF',
  gradient: ['#6B5CE7', '#8B7AEF'],
};

const TEST_RANGE: DateRange = { since: '2025-01-01', until: '2025-01-31' };

function makeProviderData(name: string): ProviderData {
  return {
    provider: name,
    displayName: name,
    daily: [],
    totalTokens: 0,
    totalCost: 0,
    colors: TEST_COLORS,
  };
}

function createMockProvider(
  name: string,
  overrides: Partial<{
    available: boolean;
    loadDelay: number;
    shouldThrow: boolean;
    errorMessage: string;
  }> = {},
): IProvider {
  const {
    available = true,
    loadDelay = 0,
    shouldThrow = false,
    errorMessage = `${name} failed`,
  } = overrides;

  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    colors: TEST_COLORS,
    async isAvailable() {
      return available;
    },
    async load(_range: DateRange) {
      if (loadDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, loadDelay));
      }
      if (shouldThrow) {
        throw new Error(errorMessage);
      }
      return makeProviderData(name);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  // -- register & getAll --------------------------------------------------

  it('registers and retrieves providers', () => {
    const registry = new ProviderRegistry();
    const p1 = createMockProvider('alpha');
    const p2 = createMockProvider('beta');

    registry.register(p1);
    registry.register(p2);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all[0]!.name).toBe('alpha');
    expect(all[1]!.name).toBe('beta');
  });

  it('throws when registering a duplicate provider name', () => {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider('dup'));
    expect(() => registry.register(createMockProvider('dup'))).toThrow(
      'Provider "dup" is already registered',
    );
  });

  // -- empty registry -----------------------------------------------------

  it('returns empty arrays when no providers are registered', async () => {
    const registry = new ProviderRegistry();

    expect(registry.getAll()).toEqual([]);
    expect(await registry.getAvailable()).toEqual([]);
    expect(await registry.loadAll(TEST_RANGE)).toEqual([]);
  });

  // -- getAvailable -------------------------------------------------------

  it('filters out unavailable providers', async () => {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider('available', { available: true }));
    registry.register(createMockProvider('missing', { available: false }));
    registry.register(createMockProvider('also-available', { available: true }));

    const available = await registry.getAvailable();
    expect(available).toHaveLength(2);
    expect(available.map((p) => p.name)).toEqual([
      'available',
      'also-available',
    ]);
  });

  // -- loadAll: happy path ------------------------------------------------

  it('loads data for all available providers', async () => {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider('a'));
    registry.register(createMockProvider('b'));
    registry.register(createMockProvider('unavail', { available: false }));

    const results = await registry.loadAll(TEST_RANGE);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.provider).sort()).toEqual(['a', 'b']);
    for (const r of results) {
      expect(r.data).not.toBeNull();
      expect(r.error).toBeNull();
    }
  });

  // -- loadAll: per-provider error isolation ------------------------------

  it('catches per-provider errors without failing others', async () => {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider('ok'));
    registry.register(
      createMockProvider('broken', {
        shouldThrow: true,
        errorMessage: 'disk read failed',
      }),
    );
    registry.register(createMockProvider('also-ok'));

    const results = await registry.loadAll(TEST_RANGE);

    expect(results).toHaveLength(3);

    const ok = results.find((r) => r.provider === 'ok')!;
    expect(ok.data).not.toBeNull();
    expect(ok.error).toBeNull();

    const broken = results.find((r) => r.provider === 'broken')!;
    expect(broken.data).toBeNull();
    expect(broken.error).toBe('disk read failed');

    const alsoOk = results.find((r) => r.provider === 'also-ok')!;
    expect(alsoOk.data).not.toBeNull();
    expect(alsoOk.error).toBeNull();
  });

  // -- loadAll: concurrency -----------------------------------------------

  it('respects concurrency limit', async () => {
    const registry = new ProviderRegistry();
    let peak = 0;
    let running = 0;

    // Create providers whose load tracks concurrency via a shared counter
    for (let i = 0; i < 6; i++) {
      const name = `p${i}`;
      const provider: IProvider = {
        name,
        displayName: name,
        colors: TEST_COLORS,
        async isAvailable() {
          return true;
        },
        async load(_range: DateRange) {
          running++;
          if (running > peak) peak = running;
          // Yield to the event loop so other workers can start
          await new Promise((resolve) => setTimeout(resolve, 10));
          running--;
          return makeProviderData(name);
        },
      };
      registry.register(provider);
    }

    const results = await registry.loadAll(TEST_RANGE, 2);

    expect(results).toHaveLength(6);
    expect(peak).toBeLessThanOrEqual(2);
  });

  // -- loadAll: non-Error throw -------------------------------------------

  it('handles non-Error thrown values gracefully', async () => {
    const registry = new ProviderRegistry();
    const provider: IProvider = {
      name: 'weird',
      displayName: 'Weird',
      colors: TEST_COLORS,
      async isAvailable() {
        return true;
      },
      async load(_range: DateRange) {
        throw 'string error'; // eslint-disable-line no-throw-literal
      },
    };
    registry.register(provider);

    const results = await registry.loadAll(TEST_RANGE);
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toBe('string error');
    expect(results[0]!.data).toBeNull();
  });
});
