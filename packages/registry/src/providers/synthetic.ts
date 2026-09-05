import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { isInRange } from '../utils';
import {
  buildProviderData,
  extractDate,
  nonNegativeNumber,
  safeNumber,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'synthetic';
const DISPLAY_NAME = 'Synthetic';
const DEFAULT_DB_PATH = join(homedir(), '.local', 'share', 'octofriend', 'sqlite.db');
const COLORS: ProviderColors = {
  primary: '#10b981',
  secondary: '#86efac',
  gradient: ['#10b981', '#86efac'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function resolveDbPath(dbPath?: string): string {
  return dbPath ?? process.env['TOKENLEAK_SYNTHETIC_DIR'] ?? DEFAULT_DB_PATH;
}

function normalizeSyntheticModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.startsWith('hf:')) {
    return lower.split('/').at(-1) ?? lower.slice(3);
  }
  const modelsMarker = '/models/';
  const index = lower.indexOf(modelsMarker);
  return index >= 0 ? lower.slice(index + modelsMarker.length) : lower;
}

function loadRows(dbPath: string): Array<Record<string, unknown>> {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return [];
  }
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    if (tables.some((row) => row.name === 'messages')) {
      return db.query('SELECT * FROM messages').all() as Array<Record<string, unknown>>;
    }
    if (tables.some((row) => row.name === 'token_usage')) {
      return db.query('SELECT * FROM token_usage').all() as Array<Record<string, unknown>>;
    }
    return [];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function rowToRecord(row: Record<string, unknown>, range: DateRange): LocalUsageRecord | null {
  const timestamp = timestampToIso(row['timestamp'] ?? row['created_at']);
  const date = timestamp ? extractDate(timestamp) : null;
  if (!timestamp || !date || !isInRange(date, range)) return null;
  const inputTokens = nonNegativeNumber(row['input_tokens'] ?? row['input']);
  const outputTokens = nonNegativeNumber(row['output_tokens'] ?? row['output']) + nonNegativeNumber(row['reasoning_tokens']);
  const cacheReadTokens = nonNegativeNumber(row['cache_read_tokens'] ?? row['cache_read']);
  const cacheWriteTokens = nonNegativeNumber(row['cache_write_tokens'] ?? row['cache_write']);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;
  return {
    date,
    timestamp,
    model: normalizeSyntheticModel(stringValue(row['model']) ?? stringValue(row['model_id']) ?? 'synthetic-unknown'),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    explicitCost: safeNumber(row['cost']) ?? safeNumber(row['cost_usd']) ?? undefined,
    sessionId: stringValue(row['session_id']) ?? stringValue(row['sessionId']) ?? undefined,
    projectId: stringValue(row['provider']) ?? 'synthetic',
  };
}

export class SyntheticProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = resolveDbPath(dbPath);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.dbPath);
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records = loadRows(this.dbPath)
      .map((row) => rowToRecord(row, range))
      .filter((record): record is LocalUsageRecord => record !== null);
    return buildProviderData(METADATA, records);
  }
}
