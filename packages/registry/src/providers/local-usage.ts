import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type {
  DailyUsage,
  ModelBreakdown,
  ProviderColors,
  ProviderData,
  UsageEvent,
} from '@tokenleak/core';
import { estimateCostBreakdown } from '../models/cost';
import { normalizeModelName } from '../models/normalizer';

export interface LocalUsageRecord {
  date: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  explicitCost?: number;
  sessionId?: string;
  projectId?: string;
  repoRoot?: string;
  directory?: string;
  durationMs?: number;
  prompt?: string;
}

export interface LocalProviderMetadata {
  provider: string;
  displayName: string;
  colors: ProviderColors;
}

export function collectFiles(
  root: string,
  predicate: (path: string, name: string) => boolean,
): string[] {
  const results: string[] = [];

  if (!existsSync(root)) {
    return results;
  }

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(root, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      results.push(...collectFiles(fullPath, predicate));
    } else if (stats.isFile() && predicate(fullPath, entry)) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

export function hasMatchingFile(
  root: string,
  predicate: (path: string, name: string) => boolean,
): boolean {
  return collectFiles(root, predicate).length > 0;
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function nonNegativeNumber(value: unknown): number {
  return Math.max(0, safeNumber(value) ?? 0);
}

export function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

export function extractDate(timestamp: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp);
  return match ? match[1]! : null;
}

export function timestampToIso(value: unknown): string | null {
  if (typeof value === 'string') {
    if (extractDate(value)) {
      return value;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  const numeric = safeNumber(value);
  if (numeric === null) {
    return null;
  }

  const millis = Math.abs(numeric) >= 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function timestampToMillis(value: unknown): number | null {
  const iso = timestampToIso(value);
  return iso === null ? null : Date.parse(iso);
}

export function fileModifiedTimestamp(file: string): string {
  try {
    return statSync(file).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export function relativePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

export function sessionIdFromFile(file: string): string {
  return basename(file).replace(/\.(jsonl?|jsonl\.\w+)$/i, '');
}

function toCachePricing(
  pricing: ReturnType<typeof estimateCostBreakdown>['pricing'],
) {
  if (!pricing) {
    return undefined;
  }

  return {
    input: pricing.input,
    cacheRead: pricing.cacheRead,
    cacheWrite: pricing.cacheWrite,
  };
}

export function toUsageEvent(
  metadata: LocalProviderMetadata,
  record: LocalUsageRecord,
): UsageEvent {
  const normalizedModel = normalizeModelName(record.model);
  const costBreakdown = estimateCostBreakdown(
    normalizedModel,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
  );
  const totalTokens =
    record.inputTokens +
    record.outputTokens +
    record.cacheReadTokens +
    record.cacheWriteTokens;

  return {
    provider: metadata.provider,
    timestamp: record.timestamp,
    date: record.date,
    model: normalizedModel,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens,
    cost:
      typeof record.explicitCost === 'number' && Number.isFinite(record.explicitCost)
        ? record.explicitCost
        : costBreakdown.totalCost,
    pricing: toCachePricing(costBreakdown.pricing),
    sessionId: record.sessionId,
    projectId: record.projectId,
    repoRoot: record.repoRoot,
    directory: record.directory,
    durationMs: record.durationMs,
    prompt: record.prompt,
  };
}

export function buildProviderData(
  metadata: LocalProviderMetadata,
  records: LocalUsageRecord[],
): ProviderData {
  const events = records.map((record) => toUsageEvent(metadata, record));
  const byDate = new Map<string, Map<string, ModelBreakdown>>();

  for (const event of events) {
    let dateMap = byDate.get(event.date);
    if (!dateMap) {
      dateMap = new Map<string, ModelBreakdown>();
      byDate.set(event.date, dateMap);
    }

    let model = dateMap.get(event.model);
    if (!model) {
      model = {
        model: event.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: 0,
        pricing: event.pricing,
      };
      dateMap.set(event.model, model);
    }

    model.inputTokens += event.inputTokens;
    model.outputTokens += event.outputTokens;
    model.cacheReadTokens += event.cacheReadTokens;
    model.cacheWriteTokens += event.cacheWriteTokens;
    model.totalTokens += event.totalTokens;
    model.cost += event.cost;
    if (!model.pricing && event.pricing) {
      model.pricing = event.pricing;
    }
  }

  const daily: DailyUsage[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, modelsByName]) => {
      const models = [...modelsByName.values()];
      const inputTokens = models.reduce((sum, model) => sum + model.inputTokens, 0);
      const outputTokens = models.reduce((sum, model) => sum + model.outputTokens, 0);
      const cacheReadTokens = models.reduce((sum, model) => sum + model.cacheReadTokens, 0);
      const cacheWriteTokens = models.reduce((sum, model) => sum + model.cacheWriteTokens, 0);
      const totalTokens = models.reduce((sum, model) => sum + model.totalTokens, 0);
      const cost = models.reduce((sum, model) => sum + model.cost, 0);

      return {
        date,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        cost,
        models,
      };
    });

  return {
    provider: metadata.provider,
    displayName: metadata.displayName,
    daily,
    totalTokens: daily.reduce((sum, day) => sum + day.totalTokens, 0),
    totalCost: daily.reduce((sum, day) => sum + day.cost, 0),
    colors: metadata.colors,
    events,
  };
}
