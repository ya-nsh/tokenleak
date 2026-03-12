import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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

/**
 * Shape of a Codex session JSONL response event.
 * We only care about `type: "response"` records that carry usage data.
 */
interface CodexResponseEvent {
  type: string;
  timestamp: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

const CODEX_COLORS: ProviderColors = {
  primary: '#10a37f',
  secondary: '#4ade80',
  gradient: ['#10a37f', '#4ade80'],
};

const DEFAULT_SESSIONS_DIR = join(
  process.env['CODEX_HOME'] ?? join(homedir(), '.codex'),
  'sessions',
);

interface CodexUsageRecord {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface SessionContext {
  model: string;
  previousTotals: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  } | null;
}

/**
 * Narrows an unknown parsed JSONL record to a CodexResponseEvent,
 * returning `null` if the record doesn't match the expected shape.
 */
function parseResponseEvent(
  record: unknown,
): CodexResponseEvent | null {
  if (
    typeof record !== 'object' ||
    record === null ||
    !('type' in record)
  ) {
    return null;
  }

  const obj = record as Record<string, unknown>;

  if (obj['type'] !== 'response') {
    return null;
  }

  if (
    typeof obj['timestamp'] !== 'string' ||
    typeof obj['model'] !== 'string' ||
    typeof obj['usage'] !== 'object' ||
    obj['usage'] === null
  ) {
    return null;
  }

  const usage = obj['usage'] as Record<string, unknown>;

  if (
    typeof usage['input_tokens'] !== 'number' ||
    typeof usage['output_tokens'] !== 'number' ||
    typeof usage['total_tokens'] !== 'number'
  ) {
    return null;
  }

  return {
    type: 'response',
    timestamp: obj['timestamp'] as string,
    model: obj['model'] as string,
    usage: {
      input_tokens: usage['input_tokens'] as number,
      output_tokens: usage['output_tokens'] as number,
      total_tokens: usage['total_tokens'] as number,
    },
  };
}

/**
 * OpenAI model names use dashed date suffixes (e.g. `o4-mini-2025-04-16`)
 * while our normalizer expects compact suffixes (`-YYYYMMDD`).
 * This converts the dashed suffix to a compact one so normalizeModelName
 * can strip it.
 */
const DASHED_DATE_SUFFIX = /-(\d{4})-(\d{2})-(\d{2})$/;

function compactModelDateSuffix(model: string): string {
  return model.replace(DASHED_DATE_SUFFIX, '-$1$2$3');
}

/**
 * Extracts the date portion (YYYY-MM-DD) from an ISO timestamp string.
 * Returns `null` if the timestamp cannot be parsed.
 */
function extractDate(timestamp: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp);
  return match ? match[1]! : null;
}

function collectJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
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

function inferModelFromContext(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const obj = record as Record<string, unknown>;
  if (obj['type'] !== 'session_meta' && obj['type'] !== 'turn_context') {
    return null;
  }

  const payload = obj['payload'];
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const meta = payload as Record<string, unknown>;
  const directModelKeys = ['model', 'model_name', 'model_slug'] as const;
  for (const key of directModelKeys) {
    if (typeof meta[key] === 'string' && meta[key].trim()) {
      return meta[key].trim();
    }
  }

  const instructions = meta['base_instructions'];
  if (typeof instructions === 'object' && instructions !== null) {
    const text = (instructions as Record<string, unknown>)['text'];
    if (typeof text === 'string') {
      const match = /based on ([A-Za-z0-9.-]+)/i.exec(text);
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
    }
  }

  return null;
}

function parseTokenCountUsage(
  record: unknown,
  context: SessionContext,
): CodexUsageRecord | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const obj = record as Record<string, unknown>;
  if (obj['type'] !== 'event_msg') {
    return null;
  }

  const timestamp = obj['timestamp'];
  const payload = obj['payload'];
  if (
    typeof timestamp !== 'string' ||
    typeof payload !== 'object' ||
    payload === null
  ) {
    return null;
  }

  const eventPayload = payload as Record<string, unknown>;
  if (eventPayload['type'] !== 'token_count') {
    return null;
  }

  const info = eventPayload['info'];
  if (typeof info !== 'object' || info === null) {
    return null;
  }

  const usageInfo = info as Record<string, unknown>;
  const lastUsage = usageInfo['last_token_usage'];
  const totalUsage = usageInfo['total_token_usage'];
  const date = extractDate(timestamp);

  if (!date) {
    return null;
  }

  const parseUsage = (
    usage: unknown,
  ): { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null => {
    if (typeof usage !== 'object' || usage === null) {
      return null;
    }

    const usageObj = usage as Record<string, unknown>;
    const inputTokens = usageObj['input_tokens'];
    const outputTokens = usageObj['output_tokens'];
    const cachedInputTokens = usageObj['cached_input_tokens'];

    if (
      typeof inputTokens !== 'number' ||
      typeof outputTokens !== 'number'
    ) {
      return null;
    }

    return {
      inputTokens,
      outputTokens,
      cachedInputTokens:
        typeof cachedInputTokens === 'number' ? cachedInputTokens : 0,
    };
  };

  let usage = parseUsage(lastUsage);

  if (!usage) {
    const cumulative = parseUsage(totalUsage);
    if (!cumulative) {
      return null;
    }

    const previous = context.previousTotals ?? {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    };
    usage = {
      inputTokens: Math.max(0, cumulative.inputTokens - previous.inputTokens),
      outputTokens: Math.max(0, cumulative.outputTokens - previous.outputTokens),
      cachedInputTokens: Math.max(
        0,
        cumulative.cachedInputTokens - previous.cachedInputTokens,
      ),
    };
    context.previousTotals = cumulative;
  } else if (parseUsage(totalUsage)) {
    context.previousTotals = parseUsage(totalUsage);
  }

  const cacheReadTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const inputTokens = Math.max(0, usage.inputTokens - cacheReadTokens);

  return {
    date,
    model: context.model,
    inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
  };
}

function parseUsageRecord(
  record: unknown,
  context: SessionContext,
): CodexUsageRecord | null {
  const inferredModel = inferModelFromContext(record);
  if (inferredModel) {
    if (context.model !== inferredModel) {
      context.model = inferredModel;
      context.previousTotals = null;
    }
    return null;
  }

  const tokenCountUsage = parseTokenCountUsage(record, context);
  if (tokenCountUsage) {
    return tokenCountUsage;
  }

  const legacyEvent = parseResponseEvent(record);
  if (!legacyEvent) {
    return null;
  }

  const date = extractDate(legacyEvent.timestamp);
  if (!date) {
    return null;
  }

  return {
    date,
    model: compactModelDateSuffix(legacyEvent.model),
    inputTokens: legacyEvent.usage.input_tokens,
    outputTokens: legacyEvent.usage.output_tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

/**
 * Codex session provider.
 *
 * Reads JSONL session files from `~/.codex/sessions/` and extracts
 * token usage from response events.
 *
 * The `baseDir` constructor parameter allows injecting a custom
 * sessions directory for testing.
 */
export class CodexProvider implements IProvider {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex';
  readonly colors: ProviderColors = CODEX_COLORS;

  private readonly sessionsDir: string;

  constructor(baseDir?: string) {
    this.sessionsDir = baseDir ?? DEFAULT_SESSIONS_DIR;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.sessionsDir);
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const dailyMap = new Map<string, Map<string, ModelBreakdown>>();
    const files = collectJsonlFiles(this.sessionsDir);

    for (const file of files) {
      const context: SessionContext = {
        model: 'gpt-5',
        previousTotals: null,
      };

      try {
        for await (const record of splitJsonlRecords(file)) {
          const usage = parseUsageRecord(record, context);
          if (!usage) {
            continue;
          }

          if (!isInRange(usage.date, range)) {
            continue;
          }

          const normalizedModel = normalizeModelName(
            compactModelDateSuffix(usage.model),
          );
          const inputTokens = usage.inputTokens;
          const outputTokens = usage.outputTokens;
          const cacheReadTokens = usage.cacheReadTokens;
          const cacheWriteTokens = usage.cacheWriteTokens;
          const cost = estimateCost(
            normalizedModel,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
          );

          if (!dailyMap.has(usage.date)) {
            dailyMap.set(usage.date, new Map());
          }
          const modelMap = dailyMap.get(usage.date)!;

          if (!modelMap.has(normalizedModel)) {
            modelMap.set(normalizedModel, {
              model: normalizedModel,
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 0,
              cost: 0,
            });
          }
          const breakdown = modelMap.get(normalizedModel)!;
          breakdown.inputTokens += inputTokens;
          breakdown.outputTokens += outputTokens;
          breakdown.cacheReadTokens += cacheReadTokens;
          breakdown.cacheWriteTokens += cacheWriteTokens;
          breakdown.totalTokens += inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
          breakdown.cost += cost;
        }
      } catch {
        // Skip files that fail to parse
        continue;
      }
    }

    const daily: DailyUsage[] = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, modelMap]) => {
        const models = [...modelMap.values()];
        const inputTokens = models.reduce((s, m) => s + m.inputTokens, 0);
        const outputTokens = models.reduce(
          (s, m) => s + m.outputTokens,
          0,
        );
        const cacheReadTokens = models.reduce(
          (s, m) => s + m.cacheReadTokens,
          0,
        );
        const cacheWriteTokens = models.reduce(
          (s, m) => s + m.cacheWriteTokens,
          0,
        );
        const totalTokens = models.reduce(
          (s, m) => s + m.totalTokens,
          0,
        );
        const cost = models.reduce((s, m) => s + m.cost, 0);

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

    const totalTokens = daily.reduce((s, d) => s + d.totalTokens, 0);
    const totalCost = daily.reduce((s, d) => s + d.cost, 0);

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
