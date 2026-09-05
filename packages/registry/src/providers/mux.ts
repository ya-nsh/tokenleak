import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { isInRange } from '../utils';
import {
  buildProviderData,
  collectFiles,
  extractDate,
  nonNegativeNumber,
  objectValue,
  safeNumber,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'mux';
const DISPLAY_NAME = 'Mux';
const DEFAULT_BASE_DIR = join(homedir(), '.mux', 'sessions');
const COLORS: ProviderColors = {
  primary: '#ec4899',
  secondary: '#f9a8d4',
  gradient: ['#ec4899', '#f9a8d4'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_MUX_DIR'] ?? DEFAULT_BASE_DIR;
}

function isMuxFile(_path: string, name: string): boolean {
  return name === 'session-usage.json';
}

function bucketTokens(bucket: unknown): number {
  return nonNegativeNumber(objectValue(bucket)?.['tokens']);
}

function bucketCost(bucket: unknown): number {
  return safeNumber(objectValue(bucket)?.['cost_usd']) ?? 0;
}

function stableCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function parseMuxFile(file: string, range: DateRange): LocalUsageRecord[] {
  let root: Record<string, unknown>;
  try {
    const obj = objectValue(JSON.parse(readFileSync(file, 'utf-8')));
    if (!obj) return [];
    root = obj;
  } catch {
    return [];
  }
  const timestamp = timestampToIso(objectValue(root['lastRequest'])?.['timestamp']);
  const date = timestamp ? extractDate(timestamp) : null;
  if (!timestamp || !date || !isInRange(date, range)) return [];
  const byModel = objectValue(root['byModel']);
  if (!byModel) return [];
  const projectId = dirname(file).split(/[\\/]/).at(-1);

  return Object.entries(byModel).flatMap(([modelKey, value]) => {
    const entry = objectValue(value);
    if (!entry) return [];
    const [providerPart, modelPart] = modelKey.includes(':') ? modelKey.split(/:(.*)/s) : ['', modelKey];
    const inputTokens = bucketTokens(entry['input']);
    const outputTokens = bucketTokens(entry['output']) + bucketTokens(entry['reasoning']);
    const cacheReadTokens = bucketTokens(entry['cached']);
    const cacheWriteTokens = bucketTokens(entry['cacheCreate']);
    const total = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    if (total === 0) return [];
    return [{
      date,
      timestamp,
      model: modelPart || modelKey,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      explicitCost: stableCost(
        bucketCost(entry['input']) +
        bucketCost(entry['output']) +
        bucketCost(entry['cached']) +
        bucketCost(entry['cacheCreate']) +
        bucketCost(entry['reasoning']),
      ),
      sessionId: projectId,
      projectId,
      directory: providerPart || undefined,
    }];
  });
}

export class MuxProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.baseDir) && collectFiles(this.baseDir, isMuxFile).length > 0;
  }

  async load(range: DateRange): Promise<ProviderData> {
    return buildProviderData(METADATA, collectFiles(this.baseDir, isMuxFile).flatMap((file) => parseMuxFile(file, range)));
  }
}
