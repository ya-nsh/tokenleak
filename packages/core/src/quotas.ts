/** Providers with live capacity adapters, independent of historical log parsers. */
export type QuotaProvider = 'claude' | 'codex' | 'copilot';
/** Vendor quota bucket. Unknown values remain null, not zero usage. */
export interface QuotaWindow {
  id: string;
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  unlimited: boolean;
}
/** Sanitized result; credentials and account identifiers are never exported. */
export interface ProviderQuota {
  provider: QuotaProvider;
  status: 'ready' | 'not-configured' | 'auth-required' | 'rate-limited' | 'unavailable';
  plan: string | null;
  windows: QuotaWindow[];
  fetchedAt: string | null;
  stale: boolean;
  message: string | null;
  retryAt: string | null;
}
/** Live snapshot, excluded from historical usage/export totals. */
export interface QuotaSnapshot {
  schemaVersion: 1;
  checkedAt: string;
  providers: ProviderQuota[];
}
