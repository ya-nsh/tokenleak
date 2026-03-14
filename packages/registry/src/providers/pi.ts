import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
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
const DEFAULT_AGENT_DIR = join(homedir(), '.pi', 'agent');
const PI_COLORS: ProviderColors = {
  primary: '#0ea5e9',
  secondary: '#67e8f9',
  gradient: ['#0ea5e9', '#67e8f9'],
};
const DASHED_DATE_SUFFIX = /-(\d{4})-(\d{2})-(\d{2})$/;

interface PiUsageRecord {
  date: string;
  timestamp: string;
  model: string;
  normalizedModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  explicitCost?: number;
  sessionId?: string;
  projectId?: string;
}

function resolveAgentDir(baseDir?: string): string {
  if (baseDir) {
    return baseDir;
  }

  return process.env['PI_CODING_AGENT_DIR'] ?? DEFAULT_AGENT_DIR;
}

function getSessionsDir(agentDir: string): string {
  return join(agentDir, 'sessions');
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsonlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractDate(timestamp: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp);
  return match ? match[1]! : null;
}

function compactModelDateSuffix(model: string): string {
  return model.replace(DASHED_DATE_SUFFIX, '-$1$2$3');
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    return extractDate(value) ? value : null;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function isSessionHeader(record: unknown): record is { type: 'session'; cwd?: string } {
  if (typeof record !== 'object' || record === null) {
    return false;
  }

  return (record as Record<string, unknown>)['type'] === 'session';
}

function parseUsageRecord(
  record: unknown,
  fallbackProjectId?: string,
  fallbackSessionId?: string,
): PiUsageRecord | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const obj = record as Record<string, unknown>;
  if (obj['type'] !== 'message') {
    return null;
  }

  const entryTimestamp = toIsoTimestamp(obj['timestamp']);
  const message = obj['message'];
  if (typeof message !== 'object' || message === null) {
    return null;
  }

  const msg = message as Record<string, unknown>;
  if (msg['role'] !== 'assistant') {
    return null;
  }

  const usage = msg['usage'];
  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const model = msg['model'];
  if (typeof model !== 'string' || !model.trim()) {
    return null;
  }

  const usageObj = usage as Record<string, unknown>;
  const inputTokens = typeof usageObj['input'] === 'number' ? usageObj['input'] : 0;
  const outputTokens = typeof usageObj['output'] === 'number' ? usageObj['output'] : 0;
  const cacheReadTokens = typeof usageObj['cacheRead'] === 'number' ? usageObj['cacheRead'] : 0;
  const cacheWriteTokens = typeof usageObj['cacheWrite'] === 'number' ? usageObj['cacheWrite'] : 0;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  if (totalTokens === 0) {
    return null;
  }

  const timestamp = entryTimestamp ?? toIsoTimestamp(msg['timestamp']);
  if (!timestamp) {
    return null;
  }

  const date = extractDate(timestamp);
  if (!date) {
    return null;
  }

  const cost =
    typeof usageObj['cost'] === 'object' && usageObj['cost'] !== null
      ? (usageObj['cost'] as Record<string, unknown>)['total']
      : undefined;
  const normalizedModel = normalizeModelName(compactModelDateSuffix(model));

  return {
    date,
    timestamp,
    model,
    normalizedModel,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    explicitCost: typeof cost === 'number' ? cost : undefined,
    sessionId: fallbackSessionId,
    projectId: fallbackProjectId,
  };
}

function getRecordCost(record: PiUsageRecord): number {
  if (typeof record.explicitCost === 'number' && Number.isFinite(record.explicitCost)) {
    return record.explicitCost;
  }

  return estimateCost(
    record.normalizedModel,
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
    model: record.normalizedModel,
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

  private readonly agentDir: string;

  constructor(baseDir?: string) {
    this.agentDir = resolveAgentDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(getSessionsDir(this.agentDir));
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const sessionsDir = getSessionsDir(this.agentDir);
    const files = await collectJsonlFiles(sessionsDir);
    const records: PiUsageRecord[] = [];

    for (const file of files) {
      let projectId: string | undefined;
      const sessionId = relative(sessionsDir, file).split(sep).join('/');

      for await (const record of splitJsonlRecords(file)) {
        if (isSessionHeader(record)) {
          projectId = typeof record.cwd === 'string' && record.cwd.trim() ? record.cwd : projectId;
          continue;
        }

        const usage = parseUsageRecord(record, projectId, sessionId);
        if (usage !== null && isInRange(usage.date, range)) {
          records.push(usage);
        }
      }
    }

    return buildProviderData(records);
  }
}
