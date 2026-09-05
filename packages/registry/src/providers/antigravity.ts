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
  nonNegativeNumber,
  objectValue,
  sessionIdFromFile,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'antigravity';
const DISPLAY_NAME = 'Antigravity';
const DEFAULT_BASE_DIR = join(homedir(), '.config', 'tokenleak', 'antigravity-cache', 'sessions');
const COLORS: ProviderColors = {
  primary: '#7c3aed',
  secondary: '#c084fc',
  gradient: ['#7c3aed', '#c084fc'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_ANTIGRAVITY_DIR'] ?? DEFAULT_BASE_DIR;
}

function isAntigravityFile(_path: string, name: string): boolean {
  return name.endsWith('.jsonl');
}

async function parseAntigravityFile(file: string, range: DateRange): Promise<LocalUsageRecord[]> {
  const records: LocalUsageRecord[] = [];
  let fallbackModel: string | null = null;
  const fallbackSessionId = sessionIdFromFile(file);

  try {
    for await (const record of splitJsonlRecords(file)) {
      const entry = objectValue(record);
      if (!entry) continue;

      if (entry['type'] === 'session_meta') {
        fallbackModel = stringValue(entry['modelId']) ?? stringValue(entry['model_id']) ?? fallbackModel;
        continue;
      }

      if (entry['type'] !== 'usage') continue;
      const timestamp = timestampToIso(entry['timestamp']);
      const date = timestamp ? extractDate(timestamp) : null;
      if (!timestamp || !date || !isInRange(date, range)) continue;

      const inputTokens = nonNegativeNumber(entry['input']);
      const outputTokens = nonNegativeNumber(entry['output']) + nonNegativeNumber(entry['reasoning']);
      const cacheReadTokens = nonNegativeNumber(entry['cacheRead']) || nonNegativeNumber(entry['cache_read']);
      const cacheWriteTokens = nonNegativeNumber(entry['cacheWrite']) || nonNegativeNumber(entry['cache_write']);
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) continue;

      records.push({
        date,
        timestamp,
        model: stringValue(entry['modelId']) ?? stringValue(entry['model_id']) ?? fallbackModel ?? 'unknown',
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        sessionId: stringValue(entry['sessionId']) ?? stringValue(entry['session_id']) ?? fallbackSessionId,
      });
    }
  } catch {
    return records;
  }

  return records;
}

export class AntigravityProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.baseDir) && collectFiles(this.baseDir, isAntigravityFile).length > 0;
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records: LocalUsageRecord[] = [];
    for (const file of collectFiles(this.baseDir, isAntigravityFile)) {
      records.push(...await parseAntigravityFile(file, range));
    }
    return buildProviderData(METADATA, records);
  }
}
