/**
 * Strips date suffixes from model names.
 *
 * Many API providers append a `-YYYYMMDD` date suffix to model identifiers
 * (e.g. `claude-sonnet-4-20250514`). This normalizer removes those suffixes
 * so that usage data can be grouped by canonical model name.
 */

const DATE_SUFFIX_PATTERN = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

/**
 * Normalizes a model name by stripping a trailing `-YYYYMMDD` date suffix.
 *
 * @example
 * normalizeModelName('claude-sonnet-4-20250514') // => 'claude-sonnet-4'
 * normalizeModelName('gpt-4o')                   // => 'gpt-4o'
 * normalizeModelName('')                          // => ''
 */
export function normalizeModelName(model: string): string {
  const normalized = model.trim().replace(/^openai\//, '').replace(DATE_SUFFIX_PATTERN, '');
  return normalized === 'gpt-5.6' ? 'gpt-5.6-sol' : normalized;
}

/** Fast is a service tier, not a different base model. Preserve it separately. */
export function resolveModelIdentity(model: string): { model: string; serviceTier?: string } {
  const normalized = normalizeModelName(model);
  if (/^gpt-[a-z0-9.-]+-fast$/.test(normalized)) {
    return { model: normalizeModelName(normalized.slice(0, -5)), serviceTier: 'fast' };
  }
  return { model: normalized };
}

export function normalizeServiceTier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const tier = value.trim().toLowerCase();
  if (tier === 'priority') return 'fast';
  return ['default', 'fast', 'flex', 'auto', 'ultrafast', 'unknown'].includes(tier) ? tier : 'unknown';
}
