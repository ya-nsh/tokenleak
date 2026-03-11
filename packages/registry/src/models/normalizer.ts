/**
 * Strips date suffixes from model names.
 *
 * Many API providers append a `-YYYYMMDD` date suffix to model identifiers
 * (e.g. `claude-sonnet-4-20250514`). This normalizer removes those suffixes
 * so that usage data can be grouped by canonical model name.
 */

const DATE_SUFFIX_PATTERN = /-\d{8}$/;

/**
 * Normalizes a model name by stripping a trailing `-YYYYMMDD` date suffix.
 *
 * @example
 * normalizeModelName('claude-sonnet-4-20250514') // => 'claude-sonnet-4'
 * normalizeModelName('gpt-4o')                   // => 'gpt-4o'
 * normalizeModelName('')                          // => ''
 */
export function normalizeModelName(model: string): string {
  return model.replace(DATE_SUFFIX_PATTERN, '');
}
