/**
 * Model downgrade paths: maps an expensive model to a cheaper alternative
 * within the same family.
 */
export const DOWNGRADE_PATHS: Readonly<Record<string, string>> = {
  // Claude 4/4.6 family
  'claude-opus-4-6': 'claude-sonnet-4-6',
  'claude-opus-4': 'claude-sonnet-4',

  // Claude 4.5 family
  'claude-opus-4-5': 'claude-sonnet-4-5',
  'claude-sonnet-4-5': 'claude-haiku-4-5',

  // Claude 3 family
  'claude-3-opus': 'claude-3.5-sonnet',
  'claude-3-sonnet': 'claude-3-haiku',

  // Claude 3.5 family
  'claude-3.5-sonnet': 'claude-3.5-haiku',

  // OpenAI GPT-4o family
  'gpt-4o': 'gpt-4o-mini',

  // OpenAI o-series
  'o1': 'o1-mini',
  'o3': 'o3-mini',
};

/**
 * Normalize a model name by lower-casing, stripping provider prefixes,
 * and removing dated suffixes like -YYYYMMDD or -YYYY-MM-DD.
 */
function normalizeModelName(model: string): string {
  let normalized = model.toLowerCase();
  // Strip provider prefix (e.g., "anthropic/claude-opus-4" → "claude-opus-4")
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex >= 0) {
    normalized = normalized.slice(slashIndex + 1);
  }
  // Strip dated suffixes: -YYYYMMDD or -YYYY-MM-DD
  normalized = normalized.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
  return normalized;
}

/**
 * Return the cheaper alternative for a model, or null if none exists.
 */
export function getDowngradePath(model: string): string | null {
  const normalized = normalizeModelName(model);
  return DOWNGRADE_PATHS[normalized] ?? null;
}
