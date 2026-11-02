import type { ProviderWarning } from '@tokenleak/core';

export interface LabeledWarning {
  provider: string;
  warning: ProviderWarning;
}

const SKIP_KINDS: ReadonlySet<ProviderWarning['kind']> = new Set(['parse', 'oversize', 'read']);
const MAX_NAMED_MODELS = 3;

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** Same warning reported twice (e.g. compare loads two ranges) counts once. */
function dedupe(warnings: readonly LabeledWarning[]): LabeledWarning[] {
  const byKey = new Map<string, LabeledWarning>();
  for (const entry of warnings) {
    const key = `${entry.provider}\0${entry.warning.kind}\0${entry.warning.file}`;
    const existing = byKey.get(key);
    if (!existing || entry.warning.count > existing.warning.count) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/** One line per warning, the pre-summary behavior kept for `--verbose`. */
export function describeWarningsVerbose(warnings: readonly LabeledWarning[]): string[] {
  return dedupe(warnings).map(({ provider, warning }) => {
    if (warning.kind === 'unknown-pricing') {
      return `Warning: ${provider} ${plural(warning.count, 'event has', 'events have')} no known price for model "${warning.file}"; cost totals are incomplete.`;
    }
    if (warning.kind === 'provider-load') {
      return `Warning: ${provider} failed to load; data from this provider is omitted.`;
    }
    return `Warning: ${provider} skipped ${plural(warning.count, `${warning.kind} entry`, `${warning.kind} entries`)} in ${warning.file}`;
  });
}

/**
 * Collapse per-file noise into at most one line per kind of problem.
 * A run used to print a dozen lines before any output; now it prints the
 * few facts that change how the numbers should be read.
 */
export function summarizeWarnings(warnings: readonly LabeledWarning[]): string[] {
  const unique = dedupe(warnings);
  const lines: string[] = [];

  for (const { provider } of unique.filter(({ warning }) => warning.kind === 'provider-load')) {
    lines.push(`Warning: ${provider} failed to load; data from this provider is omitted.`);
  }

  const unpriced = unique.filter(({ warning }) => warning.kind === 'unknown-pricing');
  if (unpriced.length > 0) {
    const events = unpriced.reduce((sum, { warning }) => sum + warning.count, 0);
    const models = [...new Set(unpriced.map(({ warning }) => warning.file))];
    const named = models.slice(0, MAX_NAMED_MODELS).join(', ');
    const more = models.length > MAX_NAMED_MODELS ? ` +${models.length - MAX_NAMED_MODELS} more` : '';
    lines.push(
      `Warning: ${plural(events, 'event', 'events')} use models with no known price (${named}${more}); costs are incomplete. Run \`tokenleak pricing\` to fix.`,
    );
  }

  const skipped = unique.filter(({ warning }) => SKIP_KINDS.has(warning.kind));
  if (skipped.length > 0) {
    const entries = skipped.reduce((sum, { warning }) => sum + warning.count, 0);
    const files = new Set(skipped.map(({ warning }) => warning.file)).size;
    const providers = [...new Set(skipped.map(({ provider }) => provider))].join(', ');
    lines.push(
      `Note: skipped ${plural(entries, 'unreadable log entry', 'unreadable log entries')} in ${plural(files, 'file', 'files')} (${providers}); totals exclude them. Use --verbose for details.`,
    );
  }

  return lines;
}
