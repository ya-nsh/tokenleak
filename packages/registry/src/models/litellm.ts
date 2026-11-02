import type { ModelPricing } from './pricing';
import { normalizeModelName } from './normalizer';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const FETCH_TIMEOUT_MS = 10_000;
const PER_TOKEN_TO_PER_MILLION = 1_000_000;

/**
 * LiteLLM providers that sell their own models at list price. Resellers,
 * gateways, regional cloud deployments, and government regions carry markups,
 * so their rows must never stand in for a model's canonical price.
 */
const FIRST_PARTY_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'gemini',
  'mistral',
  'deepseek',
  'xai',
  'cohere',
  'zai',
  'moonshot',
  'minimax',
  'dashscope',
]);

/** Lower rank wins when two LiteLLM rows map to the same lookup key. */
const KeyRank = {
  /** Bare key (`claude-opus-5-5`) published by the model's own vendor. */
  FirstPartyExact: 0,
  /** Vendor-prefixed key (`anthropic/claude-opus-5-5`) stripped to the bare name. */
  FirstPartyPrefixed: 1,
  /** Bare key from a non-vendor host. */
  ThirdPartyExact: 2,
  /** Any other prefixed key stripped to the bare name (resellers, regions). */
  ThirdPartyPrefixed: 3,
} as const;
type KeyRank = (typeof KeyRank)[keyof typeof KeyRank];

interface LiteLLMEntry {
  litellm_provider?: unknown;
  input_cost_per_token?: unknown;
  output_cost_per_token?: unknown;
  cache_read_input_token_cost?: unknown;
  cache_creation_input_token_cost?: unknown;
  cache_creation_input_token_cost_above_1hr?: unknown;
}

/** Remote pricing plus whether it came from the model vendor's own row. */
export interface RemotePricingEntry extends ModelPricing {
  firstParty: boolean;
}

function perMillion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value * PER_TOKEN_TO_PER_MILLION
    : undefined;
}

function rankFor(key: string, provider: string): KeyRank {
  const slashIndex = key.indexOf('/');
  if (slashIndex === -1) {
    return FIRST_PARTY_PROVIDERS.has(provider) ? KeyRank.FirstPartyExact : KeyRank.ThirdPartyExact;
  }
  const prefix = key.slice(0, slashIndex);
  return FIRST_PARTY_PROVIDERS.has(prefix) && prefix === provider
    ? KeyRank.FirstPartyPrefixed
    : KeyRank.ThirdPartyPrefixed;
}

/**
 * Parse raw LiteLLM pricing data into a map of model names to pricing.
 *
 * Each row is stored under its original key, and also under its unprefixed
 * and date-normalized names. Several rows usually collapse onto the same bare
 * name (`kyma/claude-opus-5`, `azure_ai/claude-opus-5`, `claude-opus-5`), so
 * derived names are claimed by rank: the vendor's own row always wins, and a
 * reseller row only fills a name nobody better has claimed. File order never
 * decides a price.
 */
export function parseLiteLLMData(
  raw: Record<string, unknown>,
): Record<string, RemotePricingEntry> {
  const result: Record<string, RemotePricingEntry> = {};
  const ranks = new Map<string, KeyRank>();

  const claim = (key: string, rank: KeyRank, pricing: ModelPricing): void => {
    const existing = ranks.get(key);
    if (existing !== undefined && existing <= rank) return;
    ranks.set(key, rank);
    result[key] = { ...pricing, firstParty: rank <= KeyRank.FirstPartyPrefixed };
  };

  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value !== 'object') continue;

    const entry = value as LiteLLMEntry;
    const input = perMillion(entry.input_cost_per_token);
    const output = perMillion(entry.output_cost_per_token);
    if (input === undefined || input <= 0 || output === undefined) continue;

    const cacheWrite1h = perMillion(entry.cache_creation_input_token_cost_above_1hr);
    const pricing: ModelPricing = {
      input,
      output,
      cacheRead: perMillion(entry.cache_read_input_token_cost) ?? 0,
      cacheWrite: perMillion(entry.cache_creation_input_token_cost) ?? 0,
      ...(cacheWrite1h !== undefined ? { cacheWrite1h } : {}),
    };

    const provider = typeof entry.litellm_provider === 'string' ? entry.litellm_provider : '';
    const rank = rankFor(key, provider);

    claim(key, rank, pricing);
    const slashIndex = key.indexOf('/');
    const unprefixed = slashIndex !== -1 ? key.slice(slashIndex + 1) : key;
    if (unprefixed !== key) claim(unprefixed, rank, pricing);

    const normalized = normalizeModelName(unprefixed);
    if (normalized !== unprefixed) claim(normalized, rank, pricing);
  }

  return result;
}

/**
 * Fetch pricing data from the LiteLLM community-maintained JSON on GitHub.
 * Returns a map of model names to pricing, or throws on network/parse failure.
 */
export async function fetchLiteLLMPricing(
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Record<string, RemotePricingEntry>> {
  if (process.env['TOKENLEAK_OFFLINE'] === '1') {
    throw new Error('LiteLLM fetch skipped: TOKENLEAK_OFFLINE=1');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(LITELLM_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`LiteLLM fetch failed: HTTP ${response.status}`);
    }
    const raw = (await response.json()) as Record<string, unknown>;
    return parseLiteLLMData(raw);
  } finally {
    clearTimeout(timeout);
  }
}
