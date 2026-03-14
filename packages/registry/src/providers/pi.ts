import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DateRange,
  DailyUsage,
  ModelBreakdown,
  ProviderColors,
  ProviderData,
  UsageEvent,
} from '@tokenleak/core';
import type { IProvider } from '../provider';
import { splitJsonlRecords } from '../parsers/jsonl-splitter';
import { normalizeModelName } from '../models/normalizer';
import { estimateCost } from '../models/cost';
import { isInRange } from '../utils';

const PROVIDER_NAME = 'pi';
const DISPLAY_NAME = 'Pi';
const PI_COLORS: ProviderColors = {
  primary: '#2563eb',
  secondary: '#7dd3fc',
  gradient: ['#2563eb', '#7dd3fc'],
};

interface PiUsageRecord {
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
}

function resolveBaseDir(baseDir?: string): string {
  if (typeof baseDir === 'string') {
    return baseDir;
  }

  return process.env['TOKENLEAK_PI_USAGE_DIR'] ?? '';
}

function collectJsonlFiles(dir: string): string[] {
  if (!dir || !existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectJsonlFiles(fullPath));
    } else if (entry.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractDate(timestamp: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp);
  return match ? match[1]! : null;
}

function parseUsageRecord(record: unknown): PiUsageRecord | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const obj = record as Record<string, unknown>;
  if (
    typeof obj['timestamp'] !== 'string' ||
    typeof obj['model'] !== 'string' ||
    typeof obj['input_tokens'] !== 'number' ||
    typeof obj['output_tokens'] !== 'number'
  ) {
    return null;
  }

  const date = extractDate(obj['timestamp']);
  if (!date) {
    return null;
  }

  const cacheReadTokens =
    typeof obj['cache_read_tokens'] === 'number' ? obj['cache_read_tokens'] : 0;
  const cacheWriteTokens =
    typeof obj['cache_write_tokens'] === 'number' ? obj['cache_write_tokens'] : 0;
  const totalTokens =
    obj['input_tokens'] + obj['output_tokens'] + cacheReadTokens + cacheWriteTokens;

  if (totalTokens === 0) {
    return null;
  }

  return {
    date,
    timestamp: obj['timestamp'],
    model: obj['model'],
    inputTokens: obj['input_tokens'],
    outputTokens: obj['output_tokens'],
    cacheReadTokens,
    cacheWriteTokens,
    explicitCost: typeof obj['cost_usd'] === 'number' ? obj['cost_usd'] : undefined,
    sessionId: typeof obj['session_id'] === 'string' ? obj['session_id'] : undefined,
    projectId: typeof obj['project_id'] === 'string' ? obj['project_id'] : undefined,
  };
}

function getRecordCost(record: PiUsageRecord): number {
  if (typeof record.explicitCost === 'number' && Number.isFinite(record.explicitCost)) {
    return record.explicitCost;
  }

  return estimateCost(
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
  );
}

function toUsageEvent(record: PiUsageRecord): UsageEvent {
  const totalTokens =
    record.inputTokens +
    record.outputTokens +
    record.cacheReadTokens +
    record.cacheWriteTokens;

  return {
    provider: PROVIDER_NAME,
    timestamp: record.timestamp,
    date: record.date,
    model: normalizeModelName(record.model),
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens,
    cost: getRecordCost(record),
    sessionId: record.sessionId,
    projectId: record.projectId,
  };
}

function buildProviderData(records: PiUsageRecord[]): ProviderData {
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
    } else {
      dateMap.set(event.model, {
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        totalTokens: event.totalTokens,
        cost: event.cost,
      });
    }
  }

  let totalTokens = 0;
  let totalCost = 0;

  const daily: DailyUsage[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, modelMap]) => {
      const models = [...modelMap.values()];
      const inputTokens = models.reduce((sum, model) => sum + model.inputTokens, 0);
      const outputTokens = models.reduce((sum, model) => sum + model.outputTokens, 0);
      const cacheReadTokens = models.reduce((sum, model) => sum + model.cacheReadTokens, 0);
      const cacheWriteTokens = models.reduce((sum, model) => sum + model.cacheWriteTokens, 0);
      const dayTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
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
    colors: PI_COLORS,
    events: events.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  };
}

export class PiProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = PI_COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return collectJsonlFiles(this.baseDir).length > 0;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const files = collectJsonlFiles(this.baseDir);
    const records: PiUsageRecord[] = [];

    for (const file of files) {
      for await (const record of splitJsonlRecords(file)) {
        const usage = parseUsageRecord(record);
        if (usage !== null && isInRange(usage.date, range)) {
          records.push(usage);
        }
      }
    }

    return buildProviderData(records);
  }
}
