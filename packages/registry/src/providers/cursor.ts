import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  DateRange,
  DailyUsage,
  ModelBreakdown,
  ProviderColors,
  ProviderData,
  ProviderWarning,
  UsageEvent,
} from '@tokenleak/core';
import type { IProvider } from '../provider';
import { resolveModelIdentity } from '../models/normalizer';
import { mergeServiceTiers } from '@tokenleak/core';
import { parseCsvLine, parseCursorHeader } from '../parsers/cursor-csv';
import { isInRange } from '../utils';
import {
  addUnknownPricingWarnings,
  buildEventCostCompleteness,
  incrementProviderWarning,
  resolveUsageCost,
} from '../costing';

const PROVIDER_NAME = 'cursor';
const DISPLAY_NAME = 'Cursor';
const CURSOR_COLORS: ProviderColors = {
  primary: '#22c55e',
  secondary: '#86efac',
  gradient: ['#22c55e', '#86efac'],
};

const DASHED_DATE_SUFFIX = /-(\d{4})-(\d{2})-(\d{2})$/;
interface UsageRecord {
  date: string;
  timestamp: string;
  model: string;
  normalizedModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  explicitCost?: number;
  serviceTier?: string;
  sessionId: string;
}

function resolveCacheDir(baseDir?: string): string {
  return baseDir ?? join(process.env['TOKENLEAK_CURSOR_DIR'] ?? join(homedir(), '.config', 'tokenleak'), 'cursor-cache');
}

function isCursorUsageFile(name: string): boolean {
  if (name === 'usage.csv') {
    return true;
  }

  if (!name.startsWith('usage.') || !name.endsWith('.csv')) {
    return false;
  }

  const stem = name.slice('usage.'.length, -'.csv'.length);
  return stem.length > 0;
}

function collectUsageFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'archive') {
      continue;
    }

    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isFile() && isCursorUsageFile(entry)) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}


function extractDate(timestamp: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp);
  return match ? match[1]! : null;
}

function toIsoTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}T12:00:00.000Z`;
  }

  const millis = Date.parse(trimmed);
  if (!Number.isFinite(millis)) {
    return null;
  }

  return new Date(millis).toISOString();
}

function parseCost(value: string): number | undefined {
  const cleaned = value.replaceAll('$', '').replaceAll(',', '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'nan') {
    return undefined;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactModelDateSuffix(model: string): string {
  return model.replace(DASHED_DATE_SUFFIX, '-$1$2$3');
}

function parseUsageFile(filePath: string, warnings: Map<string, ProviderWarning>): UsageRecord[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    incrementProviderWarning(warnings, 'read', filePath);
    return [];
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return [];
  }

  const header = parseCursorHeader(lines[0]!);
  if (!header) {
    incrementProviderWarning(warnings, 'parse', filePath);
    return [];
  }
  const dateIndex = header.get('Date')!;
  const modelIndex = header.get('Model')!;
  const inputWithCacheWriteIndex = header.get('Input (w/ Cache Write)')!;
  const inputWithoutCacheWriteIndex = header.get('Input (w/o Cache Write)')!;
  const cacheReadIndex = header.get('Cache Read')!;
  const outputIndex = header.get('Output Tokens')!;
  const costIndex = header.get('Cost')!;
  const maxRequiredIndex = Math.max(dateIndex, modelIndex, inputWithCacheWriteIndex,
    inputWithoutCacheWriteIndex, cacheReadIndex, outputIndex, costIndex);
  const accountId = filePath.endsWith('/usage.csv') || filePath.endsWith('\\usage.csv')
    ? 'active'
    : filePath
      .split(/[/\\]/)
      .pop()
      ?.replace(/^usage\./, '')
      .replace(/\.csv$/, '')
      || 'unknown';

  const records: UsageRecord[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    if (fields.length <= maxRequiredIndex) {
      incrementProviderWarning(warnings, 'parse', filePath);
      continue;
    }

    const timestamp = toIsoTimestamp(fields[dateIndex] ?? '');
    if (!timestamp) {
      incrementProviderWarning(warnings, 'parse', filePath);
      continue;
    }

    const date = extractDate(timestamp);
    if (!date) {
      continue;
    }

    const rawModel = (fields[modelIndex] ?? '').trim();
    if (!rawModel) {
      incrementProviderWarning(warnings, 'parse', filePath);
      continue;
    }

    const inputWithCacheWrite = Number((fields[inputWithCacheWriteIndex] ?? '').trim());
    const inputWithoutCacheWrite = Number((fields[inputWithoutCacheWriteIndex] ?? '').trim());
    const cacheReadTokens = Number((fields[cacheReadIndex] ?? '').trim());
    const outputTokens = Number((fields[outputIndex] ?? '').trim());

    if (
      !Number.isFinite(inputWithCacheWrite) ||
      !Number.isFinite(inputWithoutCacheWrite) ||
      !Number.isFinite(cacheReadTokens) ||
      !Number.isFinite(outputTokens)
    ) {
      incrementProviderWarning(warnings, 'parse', filePath);
      continue;
    }

    const inputTokens = Math.max(0, inputWithoutCacheWrite);
    const cacheWriteTokens = Math.max(0, inputWithCacheWrite - inputWithoutCacheWrite);
    const totalTokens =
      inputTokens +
      outputTokens +
      Math.max(0, cacheReadTokens) +
      cacheWriteTokens;

    if (totalTokens === 0) {
      continue;
    }

    const model = compactModelDateSuffix(rawModel);
    // Cursor's historical UI aliases for the same Opus 4.5 model.
    const canonical = /^claude-4\.5-opus(?:-high)?(?:-thinking)?$/.test(model) ? 'claude-opus-4-5' : model;
    const identity = resolveModelIdentity(canonical);
    records.push({
      date,
      timestamp,
      model,
      normalizedModel: identity.model,
      serviceTier: identity.serviceTier,
      inputTokens,
      outputTokens: Math.max(0, outputTokens),
      cacheReadTokens: Math.max(0, cacheReadTokens),
      cacheWriteTokens,
      explicitCost: parseCost(fields[costIndex] ?? ''),
      sessionId: `cursor-${accountId}-${timestamp}`,
    });
  }

  return records;
}

function toUsageEvent(record: UsageRecord): UsageEvent {
  const cost = resolveUsageCost({
    model: record.normalizedModel,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    explicitCost: record.explicitCost,
    serviceTier: record.serviceTier,
  });

  return {
    provider: PROVIDER_NAME,
    timestamp: record.timestamp,
    date: record.date,
    model: record.normalizedModel,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens:
      record.inputTokens +
      record.outputTokens +
      record.cacheReadTokens +
      record.cacheWriteTokens,
    cost: cost.cost,
    pricing: cost.pricing,
    costSource: cost.costSource,
    pricedTokens: cost.pricedTokens,
    unpricedTokens: cost.unpricedTokens,
    sessionId: record.sessionId,
    serviceTier: record.serviceTier,
    serviceTierSource: record.serviceTier ? 'model-name' : undefined,
  };
}

function buildProviderData(records: UsageRecord[], warnings: ProviderWarning[]): ProviderData {
  const byDate = new Map<string, Map<string, ModelBreakdown>>();
  const events = records.map(toUsageEvent);

  for (const event of events) {
    let dateMap = byDate.get(event.date);
    if (!dateMap) {
      dateMap = new Map<string, ModelBreakdown>();
      byDate.set(event.date, dateMap);
    }

    const existing = dateMap.get(event.model);
    if (existing) {
      existing.inputTokens += event.inputTokens;
      existing.outputTokens += event.outputTokens;
      existing.cacheReadTokens += event.cacheReadTokens;
      existing.cacheWriteTokens += event.cacheWriteTokens;
      existing.totalTokens += event.totalTokens;
      existing.cost += event.cost;
      existing.pricedTokens = (existing.pricedTokens ?? 0) + (event.pricedTokens ?? event.totalTokens);
      if (event.serviceTier) existing.serviceTiers = mergeServiceTiers(existing.serviceTiers, [{
        tier: event.serviceTier, tokens: event.totalTokens, cost: event.cost, unpricedTokens: event.unpricedTokens ?? 0 }]);
      existing.unpricedTokens = (existing.unpricedTokens ?? 0) + (event.unpricedTokens ?? 0);
      existing.costSource =
        (existing.unpricedTokens ?? 0) >= existing.totalTokens ? 'unpriced' : existing.costSource;
      if (!existing.pricing && event.pricing) {
        existing.pricing = event.pricing;
      }
      continue;
    }

    dateMap.set(event.model, {
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheReadTokens: event.cacheReadTokens,
      cacheWriteTokens: event.cacheWriteTokens,
      totalTokens: event.totalTokens,
      cost: event.cost,
      pricing: event.pricing,
      costSource: event.costSource,
      pricedTokens: event.pricedTokens,
      unpricedTokens: event.unpricedTokens,
      serviceTiers: event.serviceTier ? [{ tier: event.serviceTier, tokens: event.totalTokens,
        cost: event.cost, unpricedTokens: event.unpricedTokens ?? 0 }] : undefined,
    });
  }

  let totalTokens = 0;
  let totalCost = 0;
  const daily: DailyUsage[] = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, modelMap]) => {
      const models = [...modelMap.values()].sort((left, right) => left.model.localeCompare(right.model));
      const inputTokens = models.reduce((sum, model) => sum + model.inputTokens, 0);
      const outputTokens = models.reduce((sum, model) => sum + model.outputTokens, 0);
      const cacheReadTokens = models.reduce((sum, model) => sum + model.cacheReadTokens, 0);
      const cacheWriteTokens = models.reduce((sum, model) => sum + model.cacheWriteTokens, 0);
      const dayTotal = models.reduce((sum, model) => sum + model.totalTokens, 0);
      const dayCost = models.reduce((sum, model) => sum + model.cost, 0);

      totalTokens += dayTotal;
      totalCost += dayCost;

      return {
        date,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens: dayTotal,
        cost: dayCost,
        models,
      };
    });

  return {
    provider: PROVIDER_NAME,
    displayName: DISPLAY_NAME,
    daily,
    totalTokens,
    totalCost,
    colors: CURSOR_COLORS,
    events,
    costCompleteness: buildEventCostCompleteness(events),
    warnings,
  };
}

export class CursorProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = CURSOR_COLORS;

  private readonly cacheDir: string;

  constructor(baseDir?: string) {
    this.cacheDir = resolveCacheDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return collectUsageFiles(this.cacheDir).length > 0;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const files = collectUsageFiles(this.cacheDir);
    const warnings = new Map<string, ProviderWarning>();
    const records = files.flatMap((filePath) => parseUsageFile(filePath, warnings))
      .filter((record) => isInRange(record.date, range));
    addUnknownPricingWarnings(warnings, records.map(toUsageEvent));

    return buildProviderData(
      records,
      [...warnings.values()].sort(
        (a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind),
      ),
    );
  }
}
