import { existsSync } from 'node:fs';
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
  safeNumber,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'copilot';
const DISPLAY_NAME = 'GitHub Copilot';
const DEFAULT_BASE_DIR = join(homedir(), '.copilot', 'otel');
const COLORS: ProviderColors = {
  primary: '#24292f',
  secondary: '#6e7781',
  gradient: ['#24292f', '#6e7781'],
};
const METADATA: LocalProviderMetadata = {
  provider: PROVIDER_NAME,
  displayName: DISPLAY_NAME,
  colors: COLORS,
};

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_COPILOT_OTEL_DIR'] ?? DEFAULT_BASE_DIR;
}

function isCopilotFile(_path: string, name: string): boolean {
  return name.endsWith('.jsonl');
}

function attr(attributes: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(attributes[key]);
    if (value) return value;
  }
  return null;
}

function attrNumber(attributes: Record<string, unknown>, key: string): number {
  return nonNegativeNumber(attributes[key]);
}

function otelTimeToIso(value: unknown): string | null {
  if (Array.isArray(value) && value.length >= 1) {
    const seconds = safeNumber(value[0]);
    const nanos = safeNumber(value[1]) ?? 0;
    if (seconds !== null) {
      return new Date((seconds * 1000) + Math.floor(nanos / 1_000_000)).toISOString();
    }
  }
  return timestampToIso(value);
}

function isChatSpan(value: Record<string, unknown>, attributes: Record<string, unknown>): boolean {
  if (value['type'] !== 'span') {
    return false;
  }
  if (attributes['gen_ai.operation.name'] === 'chat') {
    return true;
  }
  return stringValue(value['name'])?.startsWith('chat ') ?? false;
}

async function parseCopilotFile(file: string, range: DateRange): Promise<LocalUsageRecord[]> {
  const fallbackTimestamp = fileModifiedTimestamp(file);
  const recordsByKey = new Map<string, LocalUsageRecord>();

  try {
    for await (const record of splitJsonlRecords(file)) {
      const span = objectValue(record);
      if (!span) continue;
      const attributes = objectValue(span['attributes']);
      if (!attributes || !isChatSpan(span, attributes)) {
        continue;
      }

      const model = attr(attributes, ['gen_ai.response.model', 'gen_ai.request.model']);
      if (!model) {
        continue;
      }

      const input = attrNumber(attributes, 'gen_ai.usage.input_tokens');
      const cacheRead = attrNumber(attributes, 'gen_ai.usage.cache_read.input_tokens');
      const cacheWrite = attrNumber(attributes, 'gen_ai.usage.cache_write.input_tokens');
      const output =
        attrNumber(attributes, 'gen_ai.usage.output_tokens') +
        attrNumber(attributes, 'gen_ai.usage.reasoning.output_tokens');
      const adjustedInput = input - Math.min(input, cacheRead);
      if (adjustedInput + output + cacheRead + cacheWrite === 0) {
        continue;
      }

      const timestamp =
        otelTimeToIso(span['endTime']) ??
        otelTimeToIso(span['startTime']) ??
        fallbackTimestamp;
      const date = extractDate(timestamp);
      if (!date || !isInRange(date, range)) {
        continue;
      }

      const traceId = stringValue(span['traceId']) ?? 'unknown-trace';
      const spanId = stringValue(span['spanId']) ?? 'unknown-span';
      const key = `${traceId}:${spanId}`;
      recordsByKey.set(key, {
        date,
        timestamp,
        model,
        inputTokens: adjustedInput,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        sessionId:
          attr(attributes, [
            'gen_ai.conversation.id',
            'github.copilot.conversation_id',
            'github.copilot.interaction_id',
          ]) ?? traceId,
      });
    }
  } catch {
    return [...recordsByKey.values()];
  }

  return [...recordsByKey.values()];
}

export class CopilotProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.baseDir) && collectFiles(this.baseDir, isCopilotFile).length > 0;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records: LocalUsageRecord[] = [];
    for (const file of collectFiles(this.baseDir, isCopilotFile)) {
      records.push(...await parseCopilotFile(file, range));
    }
    return buildProviderData(METADATA, records);
  }
}
