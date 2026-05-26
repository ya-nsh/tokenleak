import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { isInRange } from '../utils';
import {
  buildProviderData,
  collectFiles,
  extractDate,
  fileModifiedTimestamp,
  nonNegativeNumber,
  objectValue,
  sessionIdFromFile,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'droid';
const DISPLAY_NAME = 'Droid';
const DEFAULT_BASE_DIR = join(homedir(), '.factory', 'sessions');
const COLORS: ProviderColors = {
  primary: '#f97316',
  secondary: '#fdba74',
  gradient: ['#f97316', '#fdba74'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_DROID_DIR'] ?? DEFAULT_BASE_DIR;
}

function isDroidSettings(_path: string, name: string): boolean {
  return name.endsWith('.settings.json');
}

function normalizeDroidModel(model: string): string {
  return model
    .replace(/^custom:/i, '')
    .replace(/\[[^\]]*]/g, '')
    .trim()
    .replace(/-+$/g, '')
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function modelFromJsonl(settingsFile: string): string | null {
  try {
    const text = readFileSync(settingsFile.replace(/\.settings\.json$/, '.jsonl'), 'utf-8');
    const match = /Model:\s*([^["\\\[]+)/i.exec(text);
    return match?.[1] ? normalizeDroidModel(match[1]) : null;
  } catch {
    return null;
  }
}

function parseDroidFile(file: string, range: DateRange): LocalUsageRecord[] {
  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    const obj = objectValue(parsed);
    if (!obj) return [];
    settings = obj;
  } catch {
    return [];
  }

  const usage = objectValue(settings['tokenUsage']);
  if (!usage) return [];
  const timestamp = timestampToIso(settings['providerLockTimestamp']) ?? fileModifiedTimestamp(file);
  const date = extractDate(timestamp);
  if (!date || !isInRange(date, range)) return [];

  const inputTokens = nonNegativeNumber(usage['inputTokens']);
  const outputTokens = nonNegativeNumber(usage['outputTokens']) + nonNegativeNumber(usage['thinkingTokens']);
  const cacheReadTokens = nonNegativeNumber(usage['cacheReadTokens']);
  const cacheWriteTokens = nonNegativeNumber(usage['cacheCreationTokens']);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return [];

  const provider = stringValue(settings['providerLock']);
  const model = settings['model']
    ? normalizeDroidModel(String(settings['model']))
    : modelFromJsonl(file) ?? `${provider ?? 'droid'}-unknown`;

  return [{
    date,
    timestamp,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    sessionId: sessionIdFromFile(file).replace(/\.settings$/i, ''),
    projectId: provider ?? undefined,
  }];
}

export class DroidProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.baseDir) && collectFiles(this.baseDir, isDroidSettings).length > 0;
  }

  async load(range: DateRange): Promise<ProviderData> {
    return buildProviderData(METADATA, collectFiles(this.baseDir, isDroidSettings).flatMap((file) => parseDroidFile(file, range)));
  }
}
