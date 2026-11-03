import type { QuotaSnapshot, QuotaWindow } from '@tokenleak/core';

/** Describe resets in local time without pretending an elapsed window has renewed. */
export function formatQuotaReset(resetsAt: string | null, now = Date.now()): string {
  if (!resetsAt) return 'Reset time unavailable';
  const reset = Date.parse(resetsAt);
  if (!Number.isFinite(reset)) return 'Reset time unavailable';
  if (reset <= now) return 'Reset time passed; refresh to confirm';
  const minutes = Math.ceil((reset - now) / 60_000);
  const duration =
    minutes >= 1440
      ? `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
  return `Resets in ${duration} (${new Date(reset).toLocaleString()})`;
}
/** Remaining capacity text; raw over-limit utilization remains available in JSON. */
export function formatQuotaWindow(bucket: QuotaWindow, now = Date.now()): string {
  const expired = bucket.resetsAt !== null && Date.parse(bucket.resetsAt) <= now;
  const capacity = bucket.unlimited
    ? 'Unlimited'
    : bucket.remainingPercent === null
      ? 'Capacity unavailable'
      : `${Math.round(bucket.remainingPercent * 10) / 10}% left${expired ? ' (last reported)' : ''}`;
  const fill =
    bucket.remainingPercent === null || bucket.unlimited
      ? null
      : Math.round(Math.max(0, Math.min(100, bucket.remainingPercent)) / 10);
  const bar = fill === null ? '' : `[${'='.repeat(fill)}${'-'.repeat(10 - fill)}] `;
  return `${bucket.label}: ${bar}${capacity} | ${formatQuotaReset(bucket.resetsAt, now)}`;
}
/** Plain text snapshot shared by CLI and TUI; no historical spend estimates. */
export function quotaLines(snapshot: QuotaSnapshot, now = Date.now()): string[] {
  const lines = [
    'SUBSCRIPTION QUOTAS',
    'Account-wide provider limits; independent of the selected history period.',
    '',
  ];
  for (const provider of snapshot.providers) {
    lines.push(
      `${provider.provider.toUpperCase()}${provider.plan ? ` / ${provider.plan}` : ''} — ${provider.status}${provider.stale ? ' / STALE' : ''}`,
    );
    if (provider.fetchedAt)
      lines.push(`Last successful check: ${new Date(provider.fetchedAt).toLocaleString()}`);
    for (const bucket of provider.windows) lines.push(`  ${formatQuotaWindow(bucket, now)}`);
    if (provider.message) lines.push(provider.message);
    if (provider.retryAt) lines.push(`Retry after ${new Date(provider.retryAt).toLocaleString()}`);
    lines.push('');
  }
  return lines;
}

const QUOTA_PROVIDER_NAMES: Record<QuotaSnapshot['providers'][number]['provider'], string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
};

/**
 * One compact line for a status widget: each ready provider's tightest
 * window as capacity left, e.g. `Claude 42% · Codex 90%`. Null when no
 * provider reported a limited window.
 */
export function quotaSummary(snapshot: QuotaSnapshot): string | null {
  const parts: string[] = [];
  for (const provider of snapshot.providers) {
    if (provider.status !== 'ready') continue;
    const tightest = provider.windows
      .filter((bucket) => !bucket.unlimited && bucket.remainingPercent !== null)
      .reduce<
        number | null
      >((lowest, bucket) => (lowest === null || bucket.remainingPercent! < lowest ? bucket.remainingPercent! : lowest), null);
    if (tightest === null) continue;
    const percent = Math.round(Math.max(0, Math.min(100, tightest)));
    parts.push(
      `${QUOTA_PROVIDER_NAMES[provider.provider]} ${percent}%${provider.stale ? ' (stale)' : ''}`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
