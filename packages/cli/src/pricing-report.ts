import { existsSync } from 'node:fs';
import type { DateRange, UsageEvent } from '@tokenleak/core';
import { formatTokenCount, formatUsd } from '@tokenleak/core';
import type { ModelPricing, PricingSource, RemotePricingStatus } from '@tokenleak/registry';
import { bold, dim } from '@tokenleak/renderers';

export type PricingRowSource = PricingSource | 'provider-reported' | 'unpriced';

export interface PricingReportRow {
  model: string;
  providers: string[];
  totalTokens: number;
  unpricedTokens: number;
  cost: number;
  source: PricingRowSource;
  /** Standard-tier rates in USD per 1M tokens, when a price is known. */
  pricing: ModelPricing | null;
}

export interface PricingReport {
  dateRange: DateRange;
  rows: PricingReportRow[];
  totalTokens: number;
  unpricedTokens: number;
  overridePath: string;
  overrideFileExists: boolean;
  remote: RemotePricingStatus;
}

export interface PricingReportDeps {
  resolve: (model: string) => { pricing: ModelPricing; source: PricingSource } | undefined;
  overridePath: string;
  remote: RemotePricingStatus;
}

const SOURCE_LABELS: Record<PricingRowSource, string> = {
  override: 'your override',
  verified: 'verified',
  remote: 'LiteLLM (vendor row)',
  'provider-reported': 'provider-reported',
  unpriced: 'UNKNOWN',
};
const MS_PER_HOUR = 3_600_000;

/** Group usage by model and record which pricing source each one used. */
export function buildPricingReport(
  events: readonly UsageEvent[],
  dateRange: DateRange,
  deps: PricingReportDeps,
): PricingReport {
  const byModel = new Map<
    string,
    { providers: Set<string>; totalTokens: number; unpricedTokens: number; cost: number; reported: number }
  >();
  for (const event of events) {
    const entry = byModel.get(event.model) ?? {
      providers: new Set<string>(),
      totalTokens: 0,
      unpricedTokens: 0,
      cost: 0,
      reported: 0,
    };
    entry.providers.add(event.provider);
    entry.totalTokens += event.totalTokens;
    entry.unpricedTokens += event.unpricedTokens ?? 0;
    entry.cost += event.cost;
    if (event.costSource === 'provider-reported') entry.reported += event.totalTokens;
    byModel.set(event.model, entry);
  }

  const rows: PricingReportRow[] = [...byModel.entries()].map(([model, entry]) => {
    const resolved = deps.resolve(model);
    let source: PricingRowSource;
    if (entry.totalTokens > 0 && entry.reported >= entry.totalTokens) source = 'provider-reported';
    else if (resolved) source = resolved.source;
    else source = 'unpriced';
    return {
      model,
      providers: [...entry.providers].sort(),
      totalTokens: entry.totalTokens,
      unpricedTokens: entry.unpricedTokens,
      cost: entry.cost,
      source,
      pricing: resolved?.pricing ?? null,
    };
  });
  rows.sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));

  return {
    dateRange,
    rows,
    totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
    unpricedTokens: rows.reduce((sum, row) => sum + row.unpricedTokens, 0),
    overridePath: deps.overridePath,
    overrideFileExists: existsSync(deps.overridePath),
    remote: deps.remote,
  };
}

function describeRemote(status: RemotePricingStatus, now: number): string {
  switch (status.state) {
    case 'fresh':
    case 'stale': {
      const hours = Math.max(0, Math.round((now - status.fetchedAt) / MS_PER_HOUR));
      const age = hours < 1 ? 'under an hour' : `${hours}h`;
      return status.state === 'fresh'
        ? `LiteLLM rates cached ${age} ago`
        : `LiteLLM rates cached ${age} ago (refreshing in the background)`;
    }
    case 'network':
      return 'LiteLLM rates fetched just now';
    case 'unavailable':
      return 'LiteLLM rates unavailable (offline?) — using built-in rates only';
    case 'uninitialized':
      return 'LiteLLM rates not loaded';
  }
}

function rate(value: number | undefined): string {
  if (value === undefined) return '-';
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const clipped = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
  return align === 'left' ? clipped.padEnd(width) : clipped.padStart(width);
}

/** Render the pricing report as a plain table that fits the given width. */
export function renderPricingReport(
  report: PricingReport,
  options: { noColor: boolean; now?: number },
): string {
  const { noColor } = options;
  const now = options.now ?? Date.now();
  const lines: string[] = [];
  lines.push(bold('Tokenleak Pricing', noColor));
  lines.push(
    dim(`${report.dateRange.since} → ${report.dateRange.until} · rates are USD per 1M tokens`, noColor),
  );
  lines.push('');

  if (report.rows.length === 0) {
    lines.push('No usage in this range.');
  } else {
    const header = [
      pad('Model', 22),
      pad('Tokens', 8, 'right'),
      pad('Cost', 10, 'right'),
      pad('Source', 21),
      pad('Input', 8, 'right'),
      pad('Output', 8, 'right'),
      pad('Cache R', 8, 'right'),
      pad('Cache W', 8, 'right'),
    ].join('  ');
    lines.push(bold(header, noColor));
    for (const row of report.rows) {
      const unknown = row.source === 'unpriced';
      lines.push(
        [
          pad(row.model, 22),
          pad(formatTokenCount(row.totalTokens), 8, 'right'),
          pad(unknown ? 'unknown' : formatUsd(row.cost), 10, 'right'),
          pad(SOURCE_LABELS[row.source], 21),
          pad(rate(row.pricing?.input), 8, 'right'),
          pad(rate(row.pricing?.output), 8, 'right'),
          pad(rate(row.pricing?.cacheRead), 8, 'right'),
          pad(rate(row.pricing?.cacheWrite), 8, 'right'),
        ].join('  '),
      );
    }
  }

  lines.push('');
  if (report.unpricedTokens > 0) {
    const unpricedModels = report.rows.filter((row) => row.source === 'unpriced').map((row) => row.model);
    lines.push(
      `${formatTokenCount(report.unpricedTokens)} tokens have no known price` +
        (unpricedModels.length > 0 ? ` (${unpricedModels.join(', ')}).` : '.'),
    );
    lines.push(`Add rates to ${report.overridePath}, for example:`);
    lines.push(
      dim(
        `  {"models": {"${unpricedModels[0] ?? 'model-name'}": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75}}}`,
        noColor,
      ),
    );
  } else {
    lines.push('Every token in this range has a known price.');
  }
  lines.push(
    dim(
      `${describeRemote(report.remote, now)} · overrides: ${report.overridePath}${
        report.overrideFileExists ? '' : ' (not present)'
      }`,
      noColor,
    ),
  );
  return lines.join('\n');
}
