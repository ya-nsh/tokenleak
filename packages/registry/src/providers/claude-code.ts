import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type {
  DateRange,
  DailyUsage,
  ModelBreakdown,
  ProviderColors,
  ProviderData,
} from '@tokenleak/core';
import type { IProvider } from '../provider';
import { splitJsonlRecords } from '../parsers/jsonl-splitter';
import { normalizeModelName } from '../models/normalizer';
import { estimateCost } from '../models/cost';
import { isInRange } from '../utils';

const DEFAULT_BASE_DIR = join(homedir(), '.claude', 'projects');

const CLAUDE_CODE_COLORS: ProviderColors = {
  primary: '#ff6b35',
  secondary: '#ffa366',
  gradient: ['#ff6b35', '#ffa366'],
};

interface UsageRecord {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Recursively collects all `.jsonl` file paths under a directory.
 */
function collectJsonlFiles(dir: string): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) {
    return results;
  }

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectJsonlFiles(fullPath));
    } else if (entry.endsWith('.jsonl')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Checks whether a parsed JSONL record is an assistant message with usage data.
 * Returns extracted usage fields or null if the record doesn't qualify.
 */
function extractUsage(record: unknown): UsageRecord | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const rec = record as Record<string, unknown>;

  if (rec['type'] !== 'assistant') {
    return null;
  }

  const timestamp = rec['timestamp'];
  if (typeof timestamp !== 'string') {
    return null;
  }

  const message = rec['message'];
  if (typeof message !== 'object' || message === null) {
    return null;
  }

  const msg = message as Record<string, unknown>;
  const usage = msg['usage'];
  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const model = msg['model'];
  if (typeof model !== 'string') {
    return null;
  }

  const u = usage as Record<string, unknown>;
  const inputTokens = typeof u['input_tokens'] === 'number' ? u['input_tokens'] : 0;
  const outputTokens = typeof u['output_tokens'] === 'number' ? u['output_tokens'] : 0;
  const cacheReadTokens =
    typeof u['cache_read_input_tokens'] === 'number' ? u['cache_read_input_tokens'] : 0;
  const cacheWriteTokens =
    typeof u['cache_creation_input_tokens'] === 'number'
      ? u['cache_creation_input_tokens']
      : 0;

  // Extract YYYY-MM-DD from ISO timestamp
  const date = timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  return {
    date,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/**
 * Builds the DailyUsage array from a flat list of usage records,
 * grouping by date and model.
 */
function buildDailyUsage(records: UsageRecord[]): DailyUsage[] {
  const byDate = new Map<string, Map<string, ModelBreakdown>>();

  for (const rec of records) {
    const normalizedModel = normalizeModelName(rec.model);
    const cost = estimateCost(
      rec.model,
      rec.inputTokens,
      rec.outputTokens,
      rec.cacheReadTokens,
      rec.cacheWriteTokens,
    );

    let dateModels = byDate.get(rec.date);
    if (!dateModels) {
      dateModels = new Map<string, ModelBreakdown>();
      byDate.set(rec.date, dateModels);
    }

    let mb = dateModels.get(normalizedModel);
    if (!mb) {
      mb = {
        model: normalizedModel,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: 0,
      };
      dateModels.set(normalizedModel, mb);
    }

    mb.inputTokens += rec.inputTokens;
    mb.outputTokens += rec.outputTokens;
    mb.cacheReadTokens += rec.cacheReadTokens;
    mb.cacheWriteTokens += rec.cacheWriteTokens;
    mb.totalTokens += rec.inputTokens + rec.outputTokens + rec.cacheReadTokens + rec.cacheWriteTokens;
    mb.cost += cost;
  }

  const daily: DailyUsage[] = [];

  for (const [date, dateModels] of byDate) {
    const models = [...dateModels.values()];
    const inputTokens = models.reduce((sum, m) => sum + m.inputTokens, 0);
    const outputTokens = models.reduce((sum, m) => sum + m.outputTokens, 0);
    const cacheReadTokens = models.reduce((sum, m) => sum + m.cacheReadTokens, 0);
    const cacheWriteTokens = models.reduce((sum, m) => sum + m.cacheWriteTokens, 0);
    const totalTokens = models.reduce((sum, m) => sum + m.totalTokens, 0);
    const cost = models.reduce((sum, m) => sum + m.cost, 0);

    daily.push({
      date,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      cost,
      models,
    });
  }

  // Sort by date ascending
  daily.sort((a, b) => a.date.localeCompare(b.date));

  return daily;
}

/**
 * Claude Code JSONL provider.
 *
 * Reads assistant message logs from `~/.claude/projects` and extracts
 * token usage data. The base directory can be overridden for testing.
 */
export class ClaudeCodeProvider implements IProvider {
  readonly name = 'claude-code' as const;
  readonly displayName = 'Claude Code';
  readonly colors: ProviderColors = CLAUDE_CODE_COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? DEFAULT_BASE_DIR;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.baseDir);
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const files = collectJsonlFiles(this.baseDir);
    const allRecords: UsageRecord[] = [];

    for (const file of files) {
      try {
        for await (const record of splitJsonlRecords(file)) {
          const usage = extractUsage(record);
          if (usage !== null && isInRange(usage.date, range)) {
            allRecords.push(usage);
          }
        }
      } catch {
        // Skip files that fail to parse — corrupted files shouldn't
        // prevent loading data from other files
        continue;
      }
    }

    const daily = buildDailyUsage(allRecords);
    const totalTokens = daily.reduce((sum, d) => sum + d.totalTokens, 0);
    const totalCost = daily.reduce((sum, d) => sum + d.cost, 0);

    return {
      provider: this.name,
      displayName: this.displayName,
      daily,
      totalTokens,
      totalCost,
      colors: this.colors,
    };
  }
}
