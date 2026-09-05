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
  nonNegativeNumber,
  safeNumber,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'trae';
const DISPLAY_NAME = 'Trae';
const DEFAULT_BASE_DIR = join(homedir(), '.config', 'tokenleak', 'trae-cache', 'sessions');
const COLORS: ProviderColors = {
  primary: '#06b6d4',
  secondary: '#67e8f9',
  gradient: ['#06b6d4', '#67e8f9'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_TRAE_DIR'] ?? DEFAULT_BASE_DIR;
}

function isTraeFile(_path: string, name: string): boolean {
  return name.endsWith('.json');
}

function normalizeModel(name: string, mode?: string | null): string {
  if (!name.trim()) return mode ? `trae-${mode.toLowerCase()}` : 'trae-unknown';
  return name.toLowerCase().replace(/\s+/g, '-');
}

function parseTraeFile(file: string, range: DateRange): LocalUsageRecord[] {
  let sessions: unknown[];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    sessions = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }

  return sessions.flatMap((sessionValue) => {
    const session = typeof sessionValue === 'object' && sessionValue !== null ? sessionValue as Record<string, unknown> : null;
    if (!session) return [];
    const extra = typeof session['extra_info'] === 'object' && session['extra_info'] !== null ? session['extra_info'] as Record<string, unknown> : {};
    const timestamp = timestampToIso(session['usage_time']);
    const date = timestamp ? extractDate(timestamp) : null;
    if (!timestamp || !date || !isInRange(date, range)) return [];
    const inputTokens = nonNegativeNumber(extra['input_token']);
    const outputTokens = nonNegativeNumber(extra['output_token']);
    const cacheReadTokens = nonNegativeNumber(extra['cache_read_token']);
    const cacheWriteTokens = nonNegativeNumber(extra['cache_write_token']);
    if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return [];
    return [{
      date,
      timestamp,
      model: normalizeModel(stringValue(session['model_name']) ?? '', stringValue(session['mode'])),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      explicitCost: safeNumber(session['dollar_float']) ?? undefined,
      sessionId: stringValue(session['session_id']) ?? undefined,
    }];
  });
}

export class TraeProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.baseDir) && collectFiles(this.baseDir, isTraeFile).length > 0;
  }

  async load(range: DateRange): Promise<ProviderData> {
    return buildProviderData(METADATA, collectFiles(this.baseDir, isTraeFile).flatMap((file) => parseTraeFile(file, range)));
  }
}
