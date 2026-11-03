import { buildReplayReport, getTodayLocal } from '@tokenleak/core';
import type { ProviderData, ReplayReport } from '@tokenleak/core';

/**
 * Heatmap-aware multi-day replay input. When this is served instead of a
 * single ReplayReport, the page renders a 90-day heatmap above the cost
 * odometer and the server answers `?date=YYYY-MM-DD` and
 * `GET /api/replay?date=YYYY-MM-DD`.
 */
export interface ReplayLiveDataProvider {
  /** All days in the lookback window (most-recent first OK; the template sorts). */
  heatmap: ReplayHeatmapEntry[];
  /** Initial day rendered when the page loads. */
  initialDate: string;
  /** Initial day's already-built report (so the first paint is offline-fast). */
  initialReport: ReplayReport;
  /** Async lookup for date switching; return null when there are no events. */
  getReport: (date: string) => Promise<ReplayReport | null> | ReplayReport | null;
}

export interface ReplayHeatmapEntry {
  date: string; // YYYY-MM-DD
  tokens: number;
  cost: number;
  events: number;
}

export function isReplayLiveDataProvider(
  arg: ReplayReport | ReplayLiveDataProvider,
): arg is ReplayLiveDataProvider {
  return (arg as ReplayLiveDataProvider).getReport !== undefined;
}

/** A replay report for a day with no events, so an unknown day renders an empty state. */
export function makeEmptyReplayReport(date: string): ReplayReport {
  return {
    date,
    events: [],
    flowBlocks: [],
    tokenVelocity: [],
    summary: {
      totalSessions: 0,
      totalEvents: 0,
      flowTimeMs: 0,
      thinkTimeMs: 0,
      flowThinkRatio: 0,
      peakMinute: null,
    },
  };
}

/** Per-day totals across every provider's events, oldest first, for the replay heatmap. */
export function buildReplayHeatmap(providers: ProviderData[]): ReplayHeatmapEntry[] {
  const byDate = new Map<string, { tokens: number; cost: number; events: number }>();
  for (const provider of providers) {
    const events = provider.events ?? [];
    for (const event of events) {
      const current = byDate.get(event.date) ?? { tokens: 0, cost: 0, events: 0 };
      current.tokens += event.totalTokens;
      current.cost += event.cost;
      current.events += 1;
      byDate.set(event.date, current);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, values]) => ({
      date,
      tokens: values.tokens,
      cost: values.cost,
      events: values.events,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function latestActiveDate(heatmap: ReplayHeatmapEntry[]): string | null {
  let latest: string | null = null;
  for (const entry of heatmap) {
    if (entry.events > 0 && (latest === null || entry.date > latest)) {
      latest = entry.date;
    }
  }
  return latest;
}

/**
 * Replay data for the live page: a heatmap over every loaded day and a
 * report builder for date switching. Opens on `replayDate`, else the latest
 * day with events, else `fallbackDate`.
 */
export function buildReplayLiveDataProvider(
  providers: ProviderData[],
  replayDate: string | null,
  fallbackDate: string = getTodayLocal(),
): ReplayLiveDataProvider {
  const heatmap = buildReplayHeatmap(providers);
  const initialDate = replayDate ?? latestActiveDate(heatmap) ?? fallbackDate;
  return {
    heatmap,
    initialDate,
    initialReport: buildReplayReport(providers, initialDate),
    getReport: (date: string) => {
      const report = buildReplayReport(providers, date);
      return report.events.length > 0 ? report : null;
    },
  };
}
