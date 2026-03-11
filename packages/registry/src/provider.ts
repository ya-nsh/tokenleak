import type { ProviderColors, ProviderData, DateRange } from '@tokenleak/core';

/**
 * Interface that every data provider must implement.
 * A provider knows how to detect and load token-usage data
 * from a specific source (e.g. Claude Code JSONL logs).
 */
export interface IProvider {
  /** Unique provider key, e.g. 'claude-code' */
  readonly name: string;

  /** Human-readable display name, e.g. 'Claude Code' */
  readonly displayName: string;

  /** Brand colors used when rendering charts and cards */
  readonly colors: ProviderColors;

  /** Returns true if the provider's data source exists on disk */
  isAvailable(): Promise<boolean>;

  /** Loads and returns provider data filtered to the given date range */
  load(range: DateRange): Promise<ProviderData>;
}
