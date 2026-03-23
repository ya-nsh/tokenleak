import type { ModelPricing } from './pricing';
import { normalizeModelName } from './normalizer';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const FETCH_TIMEOUT_MS = 10_000;
const PER_TOKEN_TO_PER_MILLION = 1_000_000;

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
}

/**
 * Parse raw LiteLLM pricing data into a map of normalized model names to
 * {@link ModelPricing}. Each entry is stored under three keys:
 *
 * 1. The original key (e.g. `anthropic/claude-3-opus-20240229`)
 * 2. The unprefixed key (e.g. `claude-3-opus-20240229`)
 * 3. The normalized key (e.g. `claude-3-opus`)
 *
 * Later keys overwrite earlier ones so the normalized name is the canonical
 * lookup key.
 */
export function parseLiteLLMData(
  raw: Record<string, unknown>,
): Record<string, ModelPricing> {
  const result: Record<string, ModelPricing> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value !== 'object') continue;

    const entry = value as LiteLLMEntry;
    const inputPerToken = entry.input_cost_per_token;
    const outputPerToken = entry.output_cost_per_token;

    if (typeof inputPerToken !== 'number' || inputPerToken <= 0) continue;
    if (typeof outputPerToken !== 'number') continue;

    const pricing: ModelPricing = {
      input: inputPerToken * PER_TOKEN_TO_PER_MILLION,
      output: outputPerToken * PER_TOKEN_TO_PER_MILLION,
      cacheRead:
        typeof entry.cache_read_input_token_cost === 'number'
          ? entry.cache_read_input_token_cost * PER_TOKEN_TO_PER_MILLION
          : 0,
      cacheWrite:
        typeof entry.cache_creation_input_token_cost === 'number'
          ? entry.cache_creation_input_token_cost * PER_TOKEN_TO_PER_MILLION
          : 0,
    };

    // Store under full key
    result[key] = pricing;

    // Store under unprefixed key (strip provider/ prefix)
    const slashIndex = key.indexOf('/');
    const unprefixed = slashIndex !== -1 ? key.slice(slashIndex + 1) : key;
    result[unprefixed] = pricing;

    // Store under normalized key (strip date suffix)
    const normalized = normalizeModelName(unprefixed);
    result[normalized] = pricing;
  }

  return result;
}

/**
 * Fetch pricing data from the LiteLLM community-maintained JSON on GitHub.
 * Returns a map of model names to pricing, or throws on network/parse failure.
 */
export async function fetchLiteLLMPricing(): Promise<
  Record<string, ModelPricing>
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
