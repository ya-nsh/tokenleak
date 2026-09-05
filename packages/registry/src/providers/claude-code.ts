import { existsSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { homedir } from 'os';
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
import { collectFiles } from './local-usage';
import { splitJsonlRecords } from '../parsers/jsonl-splitter';
import { normalizeModelName } from '../models/normalizer';
import { isInRange, mapWithConcurrency } from '../utils';
import { addUnknownPricingWarnings, buildEventCostCompleteness, resolveUsageCost } from '../costing';

const DEFAULT_CONFIG_DIR = join(homedir(), '.claude');

const CLAUDE_CODE_COLORS: ProviderColors = {
  primary: '#ff6b35',
  secondary: '#ffa366',
  gradient: ['#ff6b35', '#ffa366'],
};

interface UsageRecord {
  date: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  messageId?: string;
  sessionId?: string;
  projectId?: string;
  prompt?: string;
  promptId?: string;
}

const MAX_PROMPT_CHARS = 2_000;

function resolveBaseDir(baseDir?: string): string {
  if (baseDir) {
    return baseDir;
  }

  const configDir = process.env['CLAUDE_CONFIG_DIR'];
  return join(configDir && configDir.length > 0 ? configDir : DEFAULT_CONFIG_DIR, 'projects');
}

/**
 * Recursively collects all `.jsonl` file paths under a directory.
 */
function collectJsonlFiles(dir: string): string[] {
  return collectFiles(dir, (_path, name) => name.endsWith('.jsonl'));
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
    typeof u['cache_creation_input_tokens'] === 'number' ? u['cache_creation_input_tokens'] : 0;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  if (!Number.isFinite(totalTokens) || totalTokens === 0 ||
    [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }

  // Extract YYYY-MM-DD from ISO timestamp
  const date = timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  return {
    date,
    timestamp,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    messageId: typeof msg['id'] === 'string' ? msg['id'] : undefined,
    projectId: typeof rec['cwd'] === 'string' && rec['cwd'].trim() ? rec['cwd'].trim() : undefined,
  };
}

/**
 * Extracts a human-authored user prompt from a JSONL record. Returns null for
 * non-user records, tool results, and internal (non-external) user messages.
 *
 * Handles both the legacy `type: "human"` fixture schema and the current
 * `type: "user"` live schema. Content may be either a plain string or an array
 * of content blocks ([{type: "text", text: "..."}, ...]).
 */
export function extractUserPrompt(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) return null;
  const rec = record as Record<string, unknown>;

  const type = rec['type'];
  if (type !== 'user' && type !== 'human') return null;

  // Filter out synthetic / internal user messages. If userType is present, it
  // must be 'external'; if absent (older schema), we treat as external.
  const userType = rec['userType'];
  if (userType !== undefined && userType !== 'external') return null;

  const message = rec['message'];
  if (typeof message !== 'object' || message === null) return null;
  const msg = message as Record<string, unknown>;

  const content = msg['content'];
  let text: string | null = null;

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'text' && typeof b['text'] === 'string') {
        parts.push(b['text']);
      }
    }
    if (parts.length > 0) text = parts.join('\n');
  }

  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  return trimmed.length > MAX_PROMPT_CHARS ? trimmed.slice(0, MAX_PROMPT_CHARS) : trimmed;
}

function incrementWarningCount(
  warnings: Map<string, ProviderWarning>,
  kind: ProviderWarning['kind'],
  file: string,
): void {
  const key = `${kind}:${file}`;
  const existing = warnings.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }

  warnings.set(key, { kind, file, count: 1 });
}

/**
 * Builds the DailyUsage array from a flat list of usage records,
 * grouping by date and model.
 */
function buildDailyUsage(records: UsageRecord[]): DailyUsage[] {
  const byDate = new Map<string, Map<string, ModelBreakdown>>();

  for (const rec of records) {
    const normalizedModel = normalizeModelName(rec.model);
    const cost = resolveUsageCost({
      model: rec.model,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      cacheReadTokens: rec.cacheReadTokens,
      cacheWriteTokens: rec.cacheWriteTokens,
    });

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
        pricing: cost.pricing,
        costSource: cost.costSource,
        pricedTokens: 0,
        unpricedTokens: 0,
      };
      dateModels.set(normalizedModel, mb);
    } else if (!mb.pricing && cost.pricing) {
      mb.pricing = cost.pricing;
    }

    mb.inputTokens += rec.inputTokens;
    mb.outputTokens += rec.outputTokens;
    mb.cacheReadTokens += rec.cacheReadTokens;
    mb.cacheWriteTokens += rec.cacheWriteTokens;
    mb.totalTokens +=
      rec.inputTokens + rec.outputTokens + rec.cacheReadTokens + rec.cacheWriteTokens;
    mb.cost += cost.cost;
    mb.pricedTokens = (mb.pricedTokens ?? 0) + cost.pricedTokens;
    mb.unpricedTokens = (mb.unpricedTokens ?? 0) + cost.unpricedTokens;
    mb.costSource = (mb.unpricedTokens ?? 0) >= mb.totalTokens ? 'unpriced' : mb.costSource;
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
    this.baseDir = resolveBaseDir(baseDir);
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
    const allEvents: UsageEvent[] = [];
    const warnings = new Map<string, ProviderWarning>();
    const recordsByFile = await mapWithConcurrency(files, 8, async (file) => {
      const latestRecordsByMessageId = new Map<string, UsageRecord>();
      const anonymousRecords: UsageRecord[] = [];
      const relativeFile = relative(this.baseDir, file).split(sep).join('/');
      const projectId = relative(this.baseDir, dirname(file)).split(sep).join('/');

      try {
        let lastPrompt: string | null = null;
        let promptSequence = 0;
        for await (const record of splitJsonlRecords(file, {
          onWarning: ({ kind, file: warningFile }) => incrementWarningCount(warnings, kind, warningFile),
        })) {
          const userPrompt = extractUserPrompt(record);
          if (userPrompt !== null) {
            lastPrompt = userPrompt;
            promptSequence += 1;
            continue;
          }
          const usage = extractUsage(record);
          if (usage !== null) {
            usage.sessionId = relativeFile;
            usage.projectId = usage.projectId ?? projectId;
            if (lastPrompt !== null) {
              usage.prompt = lastPrompt;
              usage.promptId = `user:${promptSequence}`;
            }
            if (usage.messageId) {
              latestRecordsByMessageId.set(usage.messageId, usage);
            } else {
              anonymousRecords.push(usage);
            }
          }
        }
      } catch {
        // Skip files that fail to parse — corrupted files shouldn't
        // prevent loading data from other files
        incrementWarningCount(warnings, 'read', file);
        return [];
      }

      return [...latestRecordsByMessageId.values(), ...anonymousRecords];
    });
    const allRecords = recordsByFile.flat().filter((record) => isInRange(record.date, range));

    const daily = buildDailyUsage(allRecords);
    for (const record of allRecords) {
      const normalizedModel = normalizeModelName(record.model);
      const cost = resolveUsageCost({
        model: record.model,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheReadTokens: record.cacheReadTokens,
        cacheWriteTokens: record.cacheWriteTokens,
      });
      allEvents.push({
        provider: this.name,
        timestamp: record.timestamp,
        date: record.date,
        model: normalizedModel,
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
        projectId: record.projectId,
        prompt: record.prompt,
        promptId: record.promptId,
      });
    }
    addUnknownPricingWarnings(warnings, allEvents);
    const totalTokens = daily.reduce((sum, d) => sum + d.totalTokens, 0);
    const totalCost = daily.reduce((sum, d) => sum + d.cost, 0);

    return {
      provider: this.name,
      displayName: this.displayName,
      daily,
      totalTokens,
      totalCost,
      colors: this.colors,
      events: allEvents,
      costCompleteness: buildEventCostCompleteness(allEvents),
      warnings: [...warnings.values()].sort(
        (a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind),
      ),
    };
  }
}
