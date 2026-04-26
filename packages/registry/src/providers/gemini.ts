import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { splitJsonlRecords } from '../parsers/jsonl-splitter';
import { isInRange } from '../utils';
import {
  buildProviderData,
  collectFiles,
  extractDate,
  fileModifiedTimestamp,
  nonNegativeNumber,
  objectValue,
  relativePath,
  sessionIdFromFile,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'gemini';
const DISPLAY_NAME = 'Gemini';
const DEFAULT_BASE_DIR = join(homedir(), '.gemini', 'tmp');
const COLORS: ProviderColors = {
  primary: '#4285f4',
  secondary: '#34a853',
  gradient: ['#4285f4', '#34a853'],
};
const METADATA: LocalProviderMetadata = {
  provider: PROVIDER_NAME,
  displayName: DISPLAY_NAME,
  colors: COLORS,
};

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_GEMINI_DIR'] ?? DEFAULT_BASE_DIR;
}

function isGeminiFile(_path: string, name: string): boolean {
  return name.endsWith('.json') || name.endsWith('.jsonl');
}

function splitInputAndCache(input: number, cached: number): { input: number; cacheRead: number } {
  const cacheRead = Math.max(0, cached);
  return {
    input: Math.max(0, input) - Math.min(Math.max(0, input), cacheRead),
    cacheRead,
  };
}

function splitSessionInputAndCache(
  input: number,
  cached: number,
  output: number,
  reasoning: number,
  tool: number,
  total: number | null,
): { input: number; cacheRead: number } {
  const normalizedInput = Math.max(0, input);
  const cacheRead = Math.max(0, cached);
  if (total === null) {
    return { input: normalizedInput, cacheRead };
  }

  const inclusiveTotal = normalizedInput + Math.max(0, output) + Math.max(0, reasoning) + Math.max(0, tool);
  const exclusiveTotal = inclusiveTotal + cacheRead;
  if (cacheRead > 0 && total === inclusiveTotal && total !== exclusiveTotal) {
    return splitInputAndCache(normalizedInput, cacheRead);
  }

  return { input: normalizedInput, cacheRead };
}

function usageRecordFromTokenFields(
  fields: Record<string, unknown>,
  model: string,
  sessionId: string,
  timestamp: string,
  cacheInclusiveInput: boolean,
): LocalUsageRecord | null {
  const date = extractDate(timestamp);
  if (!date) {
    return null;
  }

  const input =
    nonNegativeNumber(fields['promptTokenCount']) ||
    nonNegativeNumber(fields['prompt_token_count']) ||
    nonNegativeNumber(fields['prompt']) ||
    nonNegativeNumber(fields['input']) ||
    nonNegativeNumber(fields['input_tokens']) ||
    nonNegativeNumber(fields['prompt_tokens']);
  const output =
    nonNegativeNumber(fields['candidatesTokenCount']) ||
    nonNegativeNumber(fields['candidates_token_count']) ||
    nonNegativeNumber(fields['candidates']) ||
    nonNegativeNumber(fields['output']) ||
    nonNegativeNumber(fields['output_tokens']) ||
    nonNegativeNumber(fields['candidates_tokens']);
  const reasoning =
    nonNegativeNumber(fields['thoughtsTokenCount']) ||
    nonNegativeNumber(fields['thoughts_token_count']) ||
    nonNegativeNumber(fields['thoughts_tokens']) ||
    nonNegativeNumber(fields['thoughts']) ||
    nonNegativeNumber(fields['reasoning']) ||
    nonNegativeNumber(fields['reasoning_tokens']);
  const tool = nonNegativeNumber(fields['tool']) || nonNegativeNumber(fields['toolTokenCount']);
  const cached =
    nonNegativeNumber(fields['cachedContentTokenCount']) ||
    nonNegativeNumber(fields['cached_content_token_count']) ||
    nonNegativeNumber(fields['cached']) ||
    nonNegativeNumber(fields['cached_tokens']);
  const total =
    nonNegativeNumber(fields['total']) ||
    nonNegativeNumber(fields['totalTokenCount']) ||
    nonNegativeNumber(fields['total_tokens']);
  const normalized = cacheInclusiveInput
    ? splitInputAndCache(input, cached)
    : splitSessionInputAndCache(
      input,
      cached,
      output,
      reasoning,
      tool,
      total > 0 ? total : null,
    );
  const totalTokens = normalized.input + output + reasoning + tool + normalized.cacheRead;
  if (totalTokens === 0) {
    return null;
  }

  return {
    date,
    timestamp,
    model,
    inputTokens: normalized.input,
    outputTokens: output + reasoning + tool,
    cacheReadTokens: normalized.cacheRead,
    cacheWriteTokens: 0,
    sessionId,
  };
}

function parseUsageMetadata(
  value: Record<string, unknown>,
  fallbackModel: string | null,
  fallbackSessionId: string,
  fallbackTimestamp: string,
): LocalUsageRecord | null {
  const usage =
    objectValue(value['usageMetadata']) ??
    objectValue(value['usage_metadata']) ??
    objectValue(value['responseUsageMetadata']) ??
    objectValue(value['usage']);
  if (!usage) {
    return null;
  }

  const model =
    stringValue(value['model']) ??
    stringValue(value['modelId']) ??
    stringValue(value['model_id']) ??
    fallbackModel ??
    'gemini';
  const timestamp =
    timestampToIso(value['timestamp']) ??
    timestampToIso(value['createdAt']) ??
    timestampToIso(value['created_at']) ??
    fallbackTimestamp;
  return usageRecordFromTokenFields(
    usage,
    model,
    stringValue(value['sessionId']) ??
      stringValue(value['session_id']) ??
      fallbackSessionId,
    timestamp,
    true,
  );
}

function parseStatsRecords(
  stats: Record<string, unknown>,
  fallbackModel: string | null,
  sessionId: string,
  timestamp: string,
): LocalUsageRecord[] {
  const models = objectValue(stats['models']);
  if (models) {
    const records: LocalUsageRecord[] = [];
    for (const [model, data] of Object.entries(models)) {
      const modelData = objectValue(data);
      const tokens = objectValue(modelData?.['tokens']);
      if (!tokens) continue;
      const record = usageRecordFromTokenFields(tokens, model, sessionId, timestamp, true);
      if (record) {
        records.push(record);
      }
    }
    if (records.length > 0) {
      return records;
    }
  }

  const direct = usageRecordFromTokenFields(
    stats,
    fallbackModel ?? 'unknown',
    sessionId,
    timestamp,
    true,
  );
  return direct ? [direct] : [];
}

function parseSessionJson(file: string, baseDir: string, range: DateRange): LocalUsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }

  const root = objectValue(parsed);
  if (!root) {
    return [];
  }

  const fallbackTimestamp =
    timestampToIso(root['lastUpdated']) ??
    timestampToIso(root['timestamp']) ??
    timestampToIso(root['created_at']) ??
    timestampToIso(root['createdAt']) ??
    fileModifiedTimestamp(file);
  const sessionId =
    stringValue(root['sessionId']) ??
    stringValue(root['session_id']) ??
    relativePath(baseDir, file) ??
    sessionIdFromFile(file);
  const messages = Array.isArray(root['messages']) ? root['messages'] : null;

  const records: LocalUsageRecord[] = [];
  if (messages) {
    for (const message of messages) {
      const msg = objectValue(message);
      if (!msg) continue;

      const messageType = stringValue(msg['messageType']) ?? stringValue(msg['message_type']);
      if (messageType && messageType !== 'gemini' && messageType !== 'assistant') {
        continue;
      }

      const tokens = objectValue(msg['tokens']);
      const model = stringValue(msg['model']);
      if (!tokens || !model) {
        continue;
      }

      const timestamp = timestampToIso(msg['timestamp']) ?? fallbackTimestamp;
      const date = extractDate(timestamp);
      if (!date || !isInRange(date, range)) {
        continue;
      }

      const input = nonNegativeNumber(tokens['input']);
      const output = nonNegativeNumber(tokens['output']);
      const reasoning = nonNegativeNumber(tokens['thoughts']) || nonNegativeNumber(tokens['reasoning']);
      const tool = nonNegativeNumber(tokens['tool']);
      const normalized = splitSessionInputAndCache(
        input,
        nonNegativeNumber(tokens['cached']),
        output,
        reasoning,
        tool,
        nonNegativeNumber(tokens['total']) ||
          nonNegativeNumber(tokens['totalTokenCount']) ||
          nonNegativeNumber(tokens['total_tokens']) ||
          null,
      );
      const totalTokens = normalized.input + output + reasoning + tool + normalized.cacheRead;
      if (totalTokens === 0) {
        continue;
      }

      records.push({
        date,
        timestamp,
        model,
        inputTokens: normalized.input,
        outputTokens: output + reasoning + tool,
        cacheReadTokens: normalized.cacheRead,
        cacheWriteTokens: 0,
        sessionId,
      });
    }
  }

  const direct = parseUsageMetadata(
    root,
    stringValue(root['model']),
    sessionId,
    fallbackTimestamp,
  );
  if (direct && isInRange(direct.date, range)) {
    records.push(direct);
  }

  const stats = objectValue(root['stats']);
  if (stats) {
    for (const directStats of parseStatsRecords(stats, stringValue(root['model']), sessionId, fallbackTimestamp)) {
      if (isInRange(directStats.date, range)) {
        records.push(directStats);
      }
    }
  }

  return records;
}

async function parseJsonlFile(file: string, baseDir: string, range: DateRange): Promise<LocalUsageRecord[]> {
  const fallbackTimestamp = fileModifiedTimestamp(file);
  const fallbackSessionId = relativePath(baseDir, file) || sessionIdFromFile(file);
  const records: LocalUsageRecord[] = [];
  let currentModel: string | null = null;
  let currentSessionId = fallbackSessionId;

  try {
    for await (const record of splitJsonlRecords(file)) {
      const value = objectValue(record);
      if (!value) continue;

      const model = stringValue(value['model']);
      if (model) {
        currentModel = model;
      }
      const sessionId = stringValue(value['sessionId']) ?? stringValue(value['session_id']);
      if (sessionId) {
        currentSessionId = sessionId;
      }

      const usageRecord = parseUsageMetadata(
        value,
        currentModel,
        currentSessionId,
        fallbackTimestamp,
      );
      if (usageRecord && isInRange(usageRecord.date, range)) {
        records.push(usageRecord);
      }

      const stats = objectValue(value['stats']);
      if (stats) {
        for (const statsRecord of parseStatsRecords(
          stats,
          currentModel,
          currentSessionId,
          timestampToIso(value['timestamp']) ??
            timestampToIso(value['created_at']) ??
            fallbackTimestamp,
        )) {
          if (isInRange(statsRecord.date, range)) {
            records.push(statsRecord);
          }
        }
      }
    }
  } catch {
    return records;
  }

  return records;
}

export class GeminiProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.baseDir) && collectFiles(this.baseDir, isGeminiFile).length > 0;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const files = collectFiles(this.baseDir, isGeminiFile);
    const records: LocalUsageRecord[] = [];

    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        records.push(...await parseJsonlFile(file, this.baseDir, range));
      } else {
        records.push(...parseSessionJson(file, this.baseDir, range));
      }
    }

    return buildProviderData(METADATA, records);
  }
}
