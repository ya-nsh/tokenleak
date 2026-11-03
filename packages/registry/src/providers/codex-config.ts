import { readFileSync } from 'node:fs';
import { normalizeServiceTier } from '../models/normalizer';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The service tier Codex is configured to request, from `config.toml`.
 *
 * Codex session logs do not record the tier, so this is the only signal
 * available. It reflects the current setting, not necessarily the one in
 * force when older sessions ran, which is why callers mark it as configured
 * rather than recorded. The active `profile`'s `service_tier` wins over the
 * top-level one. Returns undefined when the file is missing or unreadable,
 * or names no recognizable tier: an unset tier stays unknown, because Codex
 * can default some accounts to Fast.
 */
export function readCodexConfiguredTier(configPath: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }
  let config: Record<string, unknown> | undefined;
  try {
    config = asRecord(Bun.TOML.parse(text));
  } catch {
    return undefined;
  }
  if (!config) return undefined;

  const profileName = config['profile'];
  const profile =
    typeof profileName === 'string' ? asRecord(asRecord(config['profiles'])?.[profileName]) : undefined;
  const raw = profile && 'service_tier' in profile ? profile['service_tier'] : config['service_tier'];
  if (typeof raw !== 'string') return undefined;
  const tier = normalizeServiceTier(raw);
  return tier === 'unknown' ? undefined : tier;
}
