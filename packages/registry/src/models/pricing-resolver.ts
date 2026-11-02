import type { ModelPricing } from './pricing';
import { fetchLiteLLMPricing, type RemotePricingEntry } from './litellm';
import {
  readPricingCache,
  readStalePricingCache,
  writePricingCache,
} from './pricing-cache';
import { loadPricingOverrides } from './pricing-overrides';

let remotePricing: Record<string, RemotePricingEntry> | null = null;
let overridePricing: Record<string, ModelPricing> = {};
let initialized = false;
let backgroundRefresh: Promise<void> | null = null;

/** Where this run's remote rates came from. */
export type RemotePricingStatus =
  | { state: 'fresh'; fetchedAt: number }
  | { state: 'stale'; fetchedAt: number }
  | { state: 'network' }
  | { state: 'unavailable' }
  | { state: 'uninitialized' };
let remoteStatus: RemotePricingStatus = { state: 'uninitialized' };
/** Keep a stale-cache refresh from holding a finished CLI run open for long. */
const BACKGROUND_REFRESH_TIMEOUT_MS = 5_000;

function refreshCacheInBackground(): void {
  if (backgroundRefresh) return;
  backgroundRefresh = fetchLiteLLMPricing(BACKGROUND_REFRESH_TIMEOUT_MS)
    .then((data) => writePricingCache(data))
    .catch(() => {
      // Offline or rate-limited: the stale cache keeps serving this run.
    });
}

/**
 * Initialize the pricing system.
 *
 * Fallback chain for remote (LiteLLM) rates:
 * 1. Fresh disk cache (within the 24h TTL) — instant, no network.
 * 2. Stale disk cache — used immediately for this run while a background
 *    fetch refreshes the cache for the next one. Prices never change mid-run.
 * 3. No cache at all — wait for the network once (10s timeout).
 * 4. Nothing reachable — hardcoded MODEL_PRICING only.
 *
 * User overrides from `~/.config/tokenleak/pricing.json` load first and win
 * over every other source. A broken override file throws
 * {@link PricingOverrideError}, because silently pricing with the wrong rates
 * is worse than stopping.
 */
export async function initPricing(): Promise<void> {
  if (initialized) return;

  overridePricing = loadPricingOverrides();

  try {
    const cached = readPricingCache();
    if (cached) {
      remotePricing = cached.data;
      remoteStatus = { state: 'fresh', fetchedAt: cached.fetchedAt };
      initialized = true;
      return;
    }
  } catch {
    // cache read failure is non-fatal
  }

  try {
    const stale = readStalePricingCache();
    if (stale) {
      remotePricing = stale.data;
      remoteStatus = { state: 'stale', fetchedAt: stale.fetchedAt };
      initialized = true;
      refreshCacheInBackground();
      return;
    }
  } catch {
    // cache read failure is non-fatal
  }

  try {
    const data = await fetchLiteLLMPricing();
    remotePricing = data;
    remoteStatus = { state: 'network' };
    writePricingCache(data);
  } catch {
    // All remote/cache sources failed — hardcoded pricing will be used
    remoteStatus = { state: 'unavailable' };
  }
  initialized = true;
}

/**
 * Look up a model in remote pricing data. Returns undefined if remote
 * pricing is not loaded or the model is not found.
 *
 * This is called by `getModelPricing()` in pricing.ts which handles the
 * hardcoded fallback, avoiding a circular dependency.
 */
export function getRemotePricing(model: string): RemotePricingEntry | undefined {
  return remotePricing?.[model];
}

/** The user's explicit rate for a normalized model, if they set one. */
export function getOverridePricing(model: string): ModelPricing | undefined {
  return overridePricing[model];
}

export function getRemotePricingStatus(): RemotePricingStatus {
  return remoteStatus;
}

/** Every model the user has explicitly priced. */
export function listOverrideModels(): string[] {
  return Object.keys(overridePricing);
}

/**
 * Reset pricing state. For testing only.
 */
export function resetPricingState(): void {
  remotePricing = null;
  overridePricing = {};
  initialized = false;
  backgroundRefresh = null;
  remoteStatus = { state: 'uninitialized' };
}

/**
 * Seed remote pricing for tests without touching the network or disk cache.
 * @internal
 */
export function setRemotePricingForTest(data: Record<string, RemotePricingEntry>): void {
  remotePricing = data;
  initialized = true;
}

/**
 * Seed user overrides for tests without touching the filesystem.
 * @internal
 */
export function setOverridePricingForTest(data: Record<string, ModelPricing>): void {
  overridePricing = data;
}
