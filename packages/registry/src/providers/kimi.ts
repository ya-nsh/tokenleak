import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'kimi';
const DISPLAY_NAME = 'Kimi';
const DEFAULT_BASE_DIR = join(homedir(), '.kimi');
const COLORS: ProviderColors = {
  primary: '#111827',
  secondary: '#9ca3af',
  gradient: ['#111827', '#9ca3af'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_KIMI_DIR'] ?? DEFAULT_BASE_DIR;
}

function isKimiFile(_path: string, name: string): boolean {
  return name === 'wire.jsonl';
}

function readModel(file: string): string {
  let dir = dirname(file);
  for (let i = 0; i < 4; i++) {
    const config = join(dir, 'config.json');
    try {
      const model = stringValue(JSON.parse(readFileSync(config, 'utf-8'))?.model);
      if (model) return model;
    } catch {
      // keep walking
    }
    dir = dirname(dir);
  }
  return 'kimi-for-coding';
}

async function parseKimiFile(file: string, range: DateRange): Promise<LocalUsageRecord[]> {
  const records: LocalUsageRecord[] = [];
  const model = readModel(file);
  const sessionId = dirname(file).split(/[\\/]/).at(-1) ?? 'unknown';

  try {
    for await (const record of splitJsonlRecords(file)) {
      const entry = objectValue(record);
      if (!entry || entry['type'] === 'metadata') continue;
      const message = objectValue(entry['message']);
      if (message?.['type'] !== 'StatusUpdate') continue;
      const payload = objectValue(message['payload']);
      const usage = objectValue(payload?.['token_usage']);
      if (!usage) continue;

      const timestamp = timestampToIso(entry['timestamp']);
      const date = timestamp ? extractDate(timestamp) : null;
      if (!timestamp || !date || !isInRange(date, range)) continue;

      const inputTokens = nonNegativeNumber(usage['input_other']);
      const outputTokens = nonNegativeNumber(usage['output']);
      const cacheReadTokens = nonNegativeNumber(usage['input_cache_read']);
      const cacheWriteTokens = nonNegativeNumber(usage['input_cache_creation']);
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) continue;

      records.push({
        date,
        timestamp,
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        sessionId,
        projectId: dirname(dirname(file)).split(/[\\/]/).at(-1),
      });
    }
  } catch {
    return records;
  }

  return records;
}

export class KimiProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.baseDir) && collectFiles(this.baseDir, isKimiFile).length > 0;
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records: LocalUsageRecord[] = [];
    for (const file of collectFiles(this.baseDir, isKimiFile)) {
      records.push(...await parseKimiFile(file, range));
    }
    return buildProviderData(METADATA, records);
  }
}
