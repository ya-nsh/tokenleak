import type { ModelPricing } from './pricing';
import { fetchLiteLLMPricing } from './litellm';
import {
  readPricingCache,
  readStalePricingCache,
  writePricingCache,
} from './pricing-cache';

let remotePricing: Record<string, ModelPricing> | null = null;
let initialized = false;

/**
 * Initialize the pricing system.
 *
 * Strategy: use a valid cache immediately (zero network latency), then only
 * hit the network when the cache is stale or missing. This means offline
 * startups never wait on a fetch timeout.
 *
 * Fallback chain:
 * 1. Read valid disk cache (within 1hr TTL) — instant, no network
 * 2. Fetch from LiteLLM GitHub JSON (only when cache is stale/missing)
 * 3. Read stale disk cache (any age)
 * 4. Fall through to hardcoded MODEL_PRICING (handled by getModelPricing)
 *
 * Never throws — pricing always works, at minimum using hardcoded data.
 */
export async function initPricing(): Promise<void> {
  if (initialized) return;

  // 1. Try valid cache first — avoids network entirely when fresh
  try {
    const cached = readPricingCache();
    if (cached) {
      remotePricing = cached.data;
      initialized = true;
      return;
    }
  } catch {
    // cache read failure is non-fatal
  }

  // 2. Cache is stale or missing — try network
  try {
    const data = await fetchLiteLLMPricing();
    remotePricing = data;
    try {
      writePricingCache(data);
    } catch {
      // cache write failure is non-fatal
    }
    initialized = true;
    return;
  } catch {
    // fetch failed — try stale cache
  }

  // 3. Network failed — use stale cache if available
  try {
    const stale = readStalePricingCache();
    if (stale) {
      remotePricing = stale;
      initialized = true;
      return;
    }
  } catch {
    // cache read failure is non-fatal
  }

  // All remote/cache sources failed — hardcoded pricing will be used
  initialized = true;
}

/**
 * Look up a model in remote pricing data. Returns undefined if remote
 * pricing is not loaded or the model is not found.
 *
 * This is called by `getModelPricing()` in pricing.ts which handles the
 * hardcoded fallback, avoiding a circular dependency.
 */
export function getRemotePricing(model: string): ModelPricing | undefined {
  return remotePricing?.[model];
}

/**
 * Reset pricing state. For testing only.
 */
export function resetPricingState(): void {
  remotePricing = null;
  initialized = false;
}
