import { existsSync, readdirSync } from 'node:fs';
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

const DEFAULT_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

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

/**
 * Checks whether a date string falls within the given range (inclusive).
 */
function isInRange(date: string, range: DateRange): boolean {
  return date >= range.since && date <= range.until;
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

    let files: string[];
    try {
      files = readdirSync(this.sessionsDir).filter((f) =>
        f.endsWith('.jsonl'),
      );
    } catch {
      files = [];
    }

    for (const file of files) {
      const filePath = join(this.sessionsDir, file);

      try {
        for await (const record of splitJsonlRecords(filePath)) {
          const event = parseResponseEvent(record);
          if (!event) {
            continue;
          }

          const date = extractDate(event.timestamp);
          if (!date || !isInRange(date, range)) {
            continue;
          }

          const normalizedModel = normalizeModelName(
            compactModelDateSuffix(event.model),
          );
          const inputTokens = event.usage.input_tokens;
          const outputTokens = event.usage.output_tokens;
          const cacheReadTokens = 0;
          const cacheWriteTokens = 0;
          const cost = estimateCost(
            normalizedModel,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
          );

          if (!dailyMap.has(date)) {
            dailyMap.set(date, new Map());
          }
          const modelMap = dailyMap.get(date)!;

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
          breakdown.totalTokens += inputTokens + outputTokens;
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
