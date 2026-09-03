import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
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
import { splitJsonlRecords } from '../parsers/jsonl-splitter';
import { normalizeServiceTier, resolveModelIdentity } from '../models/normalizer';
import { mergeServiceTiers } from '@tokenleak/core';
import { isInRange, mapWithConcurrency } from '../utils';
import {
  addUnknownPricingWarnings,
  buildEventCostCompleteness,
  resolveUsageCost,
} from '../costing';

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

interface CodexUsageRecord {
  date: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  prompt?: string;
  sessionId?: string;
  projectId?: string;
  turnId?: string;
  responseId?: string;
  source?: 'record' | 'notification';
  serviceTier?: string;
  serviceTierSource?: UsageEvent['serviceTierSource'];
}

interface SessionContext {
  model: string;
  sessionId?: string;
  turnId?: string;
  serviceTier?: string;
  projectId?: string;
  previousTotals: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
  } | null;
  lastUserPrompt?: string;
}

const MAX_PROMPT_CHARS = 2_000;

/**
 * Narrows an unknown parsed JSONL record to a CodexResponseEvent,
 * returning `null` if the record doesn't match the expected shape.
 */
function parseResponseEvent(record: unknown): CodexResponseEvent | null {
  if (typeof record !== 'object' || record === null || !('type' in record)) {
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

  // Instructions describe the agent, not the model serving a particular turn.
  // In particular, "based on GPT-5." must never replace explicit turn metadata.
  return null;
}

function inferProjectIdFromContext(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const obj = record as Record<string, unknown>;
  const payload = obj['payload'];
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const meta = payload as Record<string, unknown>;
  const cwd = meta['cwd'];
  return typeof cwd === 'string' && cwd.trim() ? cwd.trim() : null;
}

function extractTextElementText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const obj = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'message'] as const) {
    if (typeof obj[key] === 'string') {
      return obj[key];
    }
  }

  return null;
}

function normalizePromptText(text: string): string | null {
  const trimmed = text.replace(/\s+$/g, '').trimStart();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > MAX_PROMPT_CHARS ? trimmed.slice(0, MAX_PROMPT_CHARS) : trimmed;
}

function extractUserPrompt(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const obj = record as Record<string, unknown>;
  if (obj['type'] !== 'event_msg') {
    return null;
  }

  const payload = obj['payload'];
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const eventPayload = payload as Record<string, unknown>;
  if (eventPayload['type'] !== 'user_message') {
    return null;
  }

  if (typeof eventPayload['message'] === 'string' && eventPayload['message'].trim().length > 0) {
    return normalizePromptText(eventPayload['message']);
  }

  const parts: string[] = [];
  const textElements = eventPayload['text_elements'];
  if (Array.isArray(textElements)) {
    for (const element of textElements) {
      const text = extractTextElementText(element);
      if (text) {
        parts.push(text);
      }
    }
  }

  return normalizePromptText(parts.join('\n\n'));
}

function parseTokenCountUsage(record: unknown, context: SessionContext): CodexUsageRecord | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const obj = record as Record<string, unknown>;
  if (obj['type'] !== 'event_msg') {
    return null;
  }

  const timestamp = obj['timestamp'];
  const payload = obj['payload'];
  if (typeof timestamp !== 'string' || typeof payload !== 'object' || payload === null) {
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

  const parseUsage = (usage: unknown): SessionContext['previousTotals'] => {
    if (typeof usage !== 'object' || usage === null) {
      return null;
    }

    const usageObj = usage as Record<string, unknown>;
    const inputTokens = usageObj['input_tokens'];
    const outputTokens = usageObj['output_tokens'];
    const cachedInputTokens = usageObj['cached_input_tokens'];

    if (
      typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens < 0 ||
      typeof outputTokens !== 'number' || !Number.isFinite(outputTokens) || outputTokens < 0
    ) {
      return null;
    }

    return {
      inputTokens,
      outputTokens,
      cachedInputTokens: typeof cachedInputTokens === 'number' && Number.isFinite(cachedInputTokens)
        ? Math.max(0, cachedInputTokens) : 0,
      cacheWriteTokens: typeof usageObj['cache_write_input_tokens'] === 'number' &&
        Number.isFinite(usageObj['cache_write_input_tokens'])
        ? Math.max(0, usageObj['cache_write_input_tokens']) : 0,
    };
  };

  let usage = parseUsage(lastUsage);
  const cumulative = parseUsage(totalUsage);
  const previous = context.previousTotals;
  if (cumulative) {
    context.previousTotals = cumulative;
    // token_count is also emitted for status/rate-limit updates. A repeated
    // cumulative counter is not a new model response, even if last usage is set.
    if (previous && cumulative.inputTokens === previous.inputTokens &&
      cumulative.outputTokens === previous.outputTokens &&
      cumulative.cachedInputTokens === previous.cachedInputTokens &&
      cumulative.cacheWriteTokens === previous.cacheWriteTokens) {
      return null;
    }
  }

  if (!usage) {
    if (!cumulative) {
      return null;
    }

    // Resumed sessions/compaction may restart the counter. Model switches do not.
    const baseline = previous && cumulative.inputTokens >= previous.inputTokens &&
      cumulative.outputTokens >= previous.outputTokens ? previous : {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    };
    usage = {
      inputTokens: Math.max(0, cumulative.inputTokens - baseline.inputTokens),
      outputTokens: Math.max(0, cumulative.outputTokens - baseline.outputTokens),
      cachedInputTokens: Math.max(0, cumulative.cachedInputTokens - baseline.cachedInputTokens),
      cacheWriteTokens: Math.max(0, cumulative.cacheWriteTokens - baseline.cacheWriteTokens),
    };
  }

  const cacheReadTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const cacheWriteTokens = Math.min(usage.cacheWriteTokens, usage.inputTokens - cacheReadTokens);
  const inputTokens = Math.max(0, usage.inputTokens - cacheReadTokens - cacheWriteTokens);
  if (usage.inputTokens + usage.outputTokens === 0) return null;

  return {
    date,
    timestamp,
    model: context.model,
    inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    prompt: context.lastUserPrompt,
  };
}

function parseUsageRecord(record: unknown, context: SessionContext): CodexUsageRecord | null {
  const obj = typeof record === 'object' && record !== null ? record as Record<string, unknown> : null;
  const payload = obj?.['payload'];
  const meta = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null;
  if (obj?.['type'] === 'turn_context') {
    context.turnId = typeof meta?.['turn_id'] === 'string' ? meta['turn_id'] : undefined;
    // Missing metadata on the next turn must not inherit a previous Fast setting.
    context.serviceTier = normalizeServiceTier(meta?.['service_tier']);
  }
  if (obj?.['type'] === 'token_usage_record' && meta) {
    // New response-scoped records coexist with token_count status notifications.
    // Reuse token validation/cache accounting without changing the legacy counter.
    const usage = parseTokenCountUsage({ type: 'event_msg', timestamp: obj['timestamp'],
      payload: { type: 'token_count', info: { last_token_usage: meta['usage'] } } }, context);
    if (!usage) return null;
    const recordedTier = normalizeServiceTier(meta['service_tier']);
    return { ...usage, source: 'record',
      serviceTier: recordedTier ?? context.serviceTier,
      serviceTierSource: recordedTier ? 'response' : context.serviceTier ? 'request' : undefined,
      model: typeof meta['model'] === 'string' && meta['model'].trim() ? meta['model'].trim() : context.model,
      turnId: typeof meta['turn_id'] === 'string' ? meta['turn_id'] : context.turnId,
      responseId: typeof meta['response_id'] === 'string' ? meta['response_id'] : undefined };
  }
  if (typeof record === 'object' && record !== null && 'type' in record && record.type === 'session_meta') {
    const payload = (record as Record<string, unknown>)['payload'];
    if (typeof payload === 'object' && payload !== null && 'id' in payload && typeof payload.id === 'string') {
      context.sessionId = payload.id;
    }
  }
  const inferredProjectId = inferProjectIdFromContext(record);
  if (inferredProjectId) {
    context.projectId = inferredProjectId;
  }

  const inferredModel = inferModelFromContext(record);
  if (inferredModel) {
    if (context.model !== inferredModel) {
      context.model = inferredModel;
    }
    return null;
  }

  const userPrompt = extractUserPrompt(record);
  if (userPrompt) {
    context.lastUserPrompt = userPrompt;
    return null;
  }

  const tokenCountUsage = parseTokenCountUsage(record, context);
  if (tokenCountUsage) {
    const recordedTier = normalizeServiceTier(meta?.['service_tier']);
    return { ...tokenCountUsage, source: 'notification', turnId: context.turnId,
      serviceTier: recordedTier ?? context.serviceTier,
      serviceTierSource: recordedTier ? 'response' : context.serviceTier ? 'request' : undefined };
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
    timestamp: legacyEvent.timestamp,
    model: compactModelDateSuffix(legacyEvent.model),
    serviceTier: normalizeServiceTier(obj?.['service_tier']) ?? context.serviceTier,
    serviceTierSource: normalizeServiceTier(obj?.['service_tier']) ? 'response' : context.serviceTier ? 'request' : undefined,
    inputTokens: legacyEvent.usage.input_tokens,
    outputTokens: legacyEvent.usage.output_tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    prompt: context.lastUserPrompt,
  };
}

interface UsageCandidate {
  event: UsageEvent;
  source?: CodexUsageRecord['source'];
}

function reconcileUsageRecords(candidates: UsageCandidate[]): UsageEvent[] {
  const responses = new Set<string>();
  const unique = candidates.filter(({ event, source }) => {
    if (source !== 'record' || !event.responseId) return true;
    if (responses.has(event.responseId)) return false;
    responses.add(event.responseId);
    return true;
  });
  const mirrors = new Map<string, { timestamps: number[]; cursor: number }>();
  const keyFor = (event: UsageEvent) => JSON.stringify([event.turnId, event.inputTokens,
    event.outputTokens, event.cacheReadTokens, event.cacheWriteTokens]);
  for (const { event, source } of unique) {
    if (source !== 'record' || !event.turnId) continue;
    const key = keyFor(event);
    const matches = mirrors.get(key) ?? { timestamps: [], cursor: 0 };
    matches.timestamps.push(Date.parse(event.timestamp));
    mirrors.set(key, matches);
  }
  for (const matches of mirrors.values()) matches.timestamps.sort((a, b) => a - b);
  return unique.filter(({ event, source }) => {
    if (source !== 'notification' || !event.turnId) return true;
    const matches = mirrors.get(keyFor(event));
    if (!matches) return true;
    const timestamp = Date.parse(event.timestamp);
    // A mirrored notification can be delayed by tool processing. Pair at most
    // once, within the same turn and one minute; never deduplicate equal-size
    // responses within a single source or unrelated turns.
    while (matches.cursor < matches.timestamps.length && matches.timestamps[matches.cursor]! < timestamp - 60_000) {
      matches.cursor++;
    }
    const match = matches.timestamps[matches.cursor];
    if (match !== undefined && Math.abs(match - timestamp) <= 60_000) {
      matches.cursor++;
      return false;
    }
    return true;
  }).map(({ event }) => event);
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
  private readonly archivedSessionsDir: string | undefined;

  constructor(baseDir?: string, archivedDir?: string) {
    const codexHome = process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
    this.sessionsDir = baseDir ?? join(codexHome, 'sessions');
    // A custom directory stays isolated unless its archive is explicitly supplied.
    this.archivedSessionsDir = archivedDir ?? (baseDir ? undefined : join(codexHome, 'archived_sessions'));
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.sessionsDir) || Boolean(this.archivedSessionsDir && existsSync(this.archivedSessionsDir));
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const dailyMap = new Map<string, Map<string, ModelBreakdown>>();
    const files = [...collectJsonlFiles(this.sessionsDir),
      ...(this.archivedSessionsDir ? collectJsonlFiles(this.archivedSessionsDir) : [])];
    const warnings = new Map<string, ProviderWarning>();
    const eventsByFile = await mapWithConcurrency(files, 8, async (file) => {
      const candidates: UsageCandidate[] = [];
      const context: SessionContext = {
        model: 'unknown',
        projectId: undefined,
        previousTotals: null,
        lastUserPrompt: undefined,
      };
      const relativeFile = relative(this.sessionsDir, file).split(sep).join('/');
      const projectDir = relative(this.sessionsDir, dirname(file)).split(sep).join('/');

      try {
        for await (const record of splitJsonlRecords(file, {
          onWarning: ({ kind, file: warningFile }) => incrementWarningCount(warnings, kind, warningFile),
        })) {
          const usage = parseUsageRecord(record, context);
          if (!usage) {
            continue;
          }

          usage.sessionId = context.sessionId ?? basename(relativeFile);
          usage.projectId = context.projectId ?? (projectDir === '.' ? undefined : projectDir);

          const identity = resolveModelIdentity(compactModelDateSuffix(usage.model));
          const normalizedModel = identity.model;
          const serviceTier = usage.serviceTier ?? identity.serviceTier ?? 'unknown';
          const inputTokens = usage.inputTokens;
          const outputTokens = usage.outputTokens;
          const cacheReadTokens = usage.cacheReadTokens;
          const cacheWriteTokens = usage.cacheWriteTokens;
          const cost = resolveUsageCost({
            model: normalizedModel,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            serviceTier,
          });
          candidates.push({ source: usage.source, event: {
            provider: this.name,
            timestamp: usage.timestamp,
            date: usage.date,
            model: normalizedModel,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
            cost: cost.cost,
            pricing: cost.pricing,
            costSource: cost.costSource,
            pricedTokens: cost.pricedTokens,
            unpricedTokens: cost.unpricedTokens,
            sessionId: usage.sessionId,
            turnId: usage.turnId,
            responseId: usage.responseId,
            serviceTier,
            serviceTierSource: usage.serviceTierSource ?? (identity.serviceTier ? 'model-name' : undefined),
            projectId: usage.projectId,
            prompt: usage.prompt,
          } });
        }
      } catch {
        // Skip files that fail to parse
        incrementWarningCount(warnings, 'read', file);
        return [];
      }
      return reconcileUsageRecords(candidates).filter((event) => isInRange(event.date, range));
    });
    // Moving a session into the archive must not count overlapping copies twice.
    // Include timestamp and session identity: equal token counts alone are not duplicates.
    const seen = new Map<string, number>();
    const events = eventsByFile.flatMap((fileEvents, fileIndex) => fileEvents.filter((event) => {
      const key = event.responseId ? JSON.stringify([event.sessionId, event.responseId]) : JSON.stringify([event.sessionId, event.timestamp, event.model,
        event.inputTokens, event.outputTokens, event.cacheReadTokens, event.cacheWriteTokens]);
      const previousFile = seen.get(key);
      if (previousFile !== undefined && previousFile !== fileIndex) return false;
      seen.set(key, fileIndex);
      return true;
    }));
    addUnknownPricingWarnings(warnings, events);

    for (const event of events) {
      if (!dailyMap.has(event.date)) {
        dailyMap.set(event.date, new Map());
      }
      const modelMap = dailyMap.get(event.date)!;

      if (!modelMap.has(event.model)) {
        modelMap.set(event.model, {
          model: event.model,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          cost: 0,
          pricing: event.pricing,
          costSource: event.costSource,
          pricedTokens: 0,
          unpricedTokens: 0,
        });
      }
      const breakdown = modelMap.get(event.model)!;
      breakdown.inputTokens += event.inputTokens;
      breakdown.outputTokens += event.outputTokens;
      breakdown.cacheReadTokens += event.cacheReadTokens;
      breakdown.cacheWriteTokens += event.cacheWriteTokens;
      breakdown.totalTokens += event.totalTokens;
      breakdown.cost += event.cost;
      breakdown.pricedTokens = (breakdown.pricedTokens ?? 0) + (event.pricedTokens ?? event.totalTokens);
      breakdown.unpricedTokens = (breakdown.unpricedTokens ?? 0) + (event.unpricedTokens ?? 0);
      breakdown.serviceTiers = mergeServiceTiers(breakdown.serviceTiers, [{ tier: event.serviceTier ?? 'unknown',
        tokens: event.totalTokens, cost: event.cost, unpricedTokens: event.unpricedTokens ?? 0 }]);
      breakdown.costSource =
        (breakdown.unpricedTokens ?? 0) >= breakdown.totalTokens ? 'unpriced' : breakdown.costSource;
      if (!breakdown.pricing) {
        breakdown.pricing = event.pricing;
      }
    }

    const daily: DailyUsage[] = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, modelMap]) => {
        const models = [...modelMap.values()];
        const inputTokens = models.reduce((s, m) => s + m.inputTokens, 0);
        const outputTokens = models.reduce((s, m) => s + m.outputTokens, 0);
        const cacheReadTokens = models.reduce((s, m) => s + m.cacheReadTokens, 0);
        const cacheWriteTokens = models.reduce((s, m) => s + m.cacheWriteTokens, 0);
        const totalTokens = models.reduce((s, m) => s + m.totalTokens, 0);
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
      events,
      costCompleteness: buildEventCostCompleteness(events),
      warnings: [...warnings.values()].sort(
        (a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind),
      ),
    };
  }
}
