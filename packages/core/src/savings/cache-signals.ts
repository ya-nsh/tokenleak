import type { ProviderData } from '../types';
import { TOKENS_PER_MILLION, recipe, severityFor, type Finding } from './shared';

/** Cache hit rates below this are flagged. */
const LOW_CACHE_HIT_RATE = 0.25;
/** The hit rate the savings estimate assumes stable context could reach. */
const TARGET_CACHE_HIT_RATE = 0.5;
/** Fewer cache reads per write than this means writes are not paying back. */
const LOW_CACHE_REUSE_RATIO = 2;
/** Above this many unreused write tokens, wasted writes are medium severity. */
const HEAVY_CACHE_WRITE_TOKENS = 100_000;

interface CacheTotals {
  input: number;
  read: number;
  write: number;
}

function cacheTotals(provider: ProviderData): CacheTotals {
  const totals = { input: 0, read: 0, write: 0 };
  for (const day of provider.daily) {
    totals.input += day.inputTokens;
    totals.read += day.cacheReadTokens;
    totals.write += day.cacheWriteTokens;
  }
  return totals;
}

/**
 * What one input token costs above one cache-read token, per token, weighted
 * by each event's input. Null when no event carries its rates.
 */
function inputOverCacheReadPrice(provider: ProviderData): number | null {
  let weighted = 0;
  let inputTokens = 0;
  for (const event of provider.events ?? []) {
    if (!event.pricing || event.inputTokens <= 0) continue;
    weighted += event.inputTokens * Math.max(0, event.pricing.input - event.pricing.cacheRead);
    inputTokens += event.inputTokens;
  }
  return inputTokens > 0 ? weighted / inputTokens / TOKENS_PER_MILLION : null;
}

/**
 * Savings if fresh input were served from cache up to the target hit rate,
 * priced at the provider's own input and cache-read rates.
 */
function cacheMissSavings(provider: ProviderData, totals: CacheTotals): number | null {
  const pricePerToken = inputOverCacheReadPrice(provider);
  if (pricePerToken === null) return null;
  const context = totals.input + totals.read + totals.write;
  const convertible = Math.min(
    totals.input,
    Math.max(0, TARGET_CACHE_HIT_RATE * context - totals.read),
  );
  const savings = convertible * pricePerToken;
  return savings > 0 ? savings : null;
}

/** Per-provider cache findings: low hit rates and cache writes that are never read back. */
export function detectCacheFindings(providers: readonly ProviderData[]): Finding[] {
  const findings: Finding[] = [];
  for (const provider of providers) {
    const totals = cacheTotals(provider);
    // A provider that never caches cannot be told to cache better.
    if (totals.read === 0 && totals.write === 0) continue;
    const eventCount = provider.events?.length ?? 0;
    const context = totals.input + totals.read + totals.write;
    const hitRate = context > 0 ? totals.read / context : 0;

    if (hitRate < LOW_CACHE_HIT_RATE) {
      const savings = cacheMissSavings(provider, totals);
      findings.push({
        kind: 'cache-miss-heavy',
        title: 'Low cache hit rate',
        severity: severityFor(savings ?? 0),
        confidence: savings === null ? 'low' : 'medium',
        estimatedSavings: savings,
        evidence: {
          provider: provider.provider,
          eventCount,
          tokens: provider.totalTokens,
          cost: provider.totalCost,
          reason:
            `Cache hit rate is ${Math.round(hitRate * 100)}% for ${provider.displayName}; ` +
            `the estimate assumes ${Math.round(TARGET_CACHE_HIT_RATE * 100)}% at its own input and cache-read rates.`,
        },
        recipes: [
          recipe(
            'Stabilize reusable context',
            'Move stable instructions into project guidance and avoid resending large changing context blocks.',
          ),
        ],
      });
    }

    const reuseRatio = totals.write > 0 ? totals.read / totals.write : null;
    if (reuseRatio !== null && reuseRatio < LOW_CACHE_REUSE_RATIO) {
      findings.push({
        kind: 'cache-write-waste',
        title: 'Cache writes are not paying back',
        severity: totals.write > HEAVY_CACHE_WRITE_TOKENS ? 'medium' : 'low',
        confidence: 'medium',
        estimatedSavings: null,
        evidence: {
          provider: provider.provider,
          eventCount,
          tokens: totals.write,
          cost: provider.totalCost,
          reason: `Cache reuse ratio is ${reuseRatio.toFixed(1)}x from ${totals.write.toLocaleString('en-US')} write tokens for ${provider.displayName}.`,
        },
        recipes: [
          recipe(
            'Batch related work',
            'Keep stable instructions unchanged and group related tasks so cache writes are reused.',
          ),
        ],
      });
    }
  }
  return findings;
}
