import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { DateRange, ProviderColors, ProviderData, ProviderWarning } from '@tokenleak/core';
import type { IProvider } from '../provider';
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

const PROVIDER_NAME = 'kiro';
const DISPLAY_NAME = 'Kiro';
const COLORS: ProviderColors = {
  primary: '#6366f1',
  secondary: '#a5b4fc',
  gradient: ['#6366f1', '#a5b4fc'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function defaultBaseDir(): string {
  const override = process.env['TOKENLEAK_KIRO_DIR'];
  if (override && !override.endsWith('.sqlite3') && !override.endsWith('.db')) return override;
  return join(homedir(), '.kiro', 'sessions', 'cli');
}

function defaultDbPaths(): string[] {
  const override = process.env['TOKENLEAK_KIRO_DIR'];
  if (override && (override.endsWith('.sqlite3') || override.endsWith('.db'))) return [override];
  return [
    join(homedir(), '.local', 'share', 'kiro-cli', 'data.sqlite3'),
    join(homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3'),
  ];
}

function isKiroFile(_path: string, name: string): boolean {
  return name.endsWith('.json');
}

function projectFromCwd(cwd: unknown): string | undefined {
  return stringValue(cwd)?.split(/[\\/]/).filter(Boolean).at(-1);
}

interface KiroUsageRecord extends LocalUsageRecord {
  turnKey: string;
}

function parseKiroSessionObject(value: Record<string, unknown>, fallbackSessionId: string, range: DateRange): KiroUsageRecord[] {
  const state = objectValue(value['session_state']);
  const modelInfo = objectValue(objectValue(state?.['rts_model_state'])?.['model_info']);
  const model = stringValue(modelInfo?.['model_id']) ?? 'kiro-unknown';
  const sessionId = stringValue(value['session_id']) ?? fallbackSessionId;
  const projectId = projectFromCwd(value['cwd']);
  const metadata = objectValue(state?.['conversation_metadata']);
  const turns = Array.isArray(metadata?.['user_turn_metadatas']) ? metadata['user_turn_metadatas'] as unknown[] : [];

  return turns.flatMap((turnValue, index) => {
    const turn = objectValue(turnValue);
    if (!turn) return [];
    const timestamp = timestampToIso(turn['end_timestamp']);
    const date = timestamp ? extractDate(timestamp) : null;
    if (!timestamp || !date) return [];
    const inputTokens = nonNegativeNumber(turn['input_token_count']);
    const outputTokens = nonNegativeNumber(turn['output_token_count']);
    if (inputTokens + outputTokens === 0) return [];
    return [{
      date,
      timestamp,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sessionId,
      turnKey: JSON.stringify([sessionId, stringValue(turn['turn_id']) ?? index]),
      projectId,
    }];
  });
}

function parseKiroFile(file: string, range: DateRange): KiroUsageRecord[] {
  try {
    const value = objectValue(JSON.parse(readFileSync(file, 'utf-8')));
    return value ? parseKiroSessionObject(value, file, range) : [];
  } catch {
    return [];
  }
}

function parseKiroSqlite(dbPath: string, range: DateRange, warnings: ProviderWarning[]): KiroUsageRecord[] {
  if (!existsSync(dbPath)) return [];
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return [];
  }
  try {
    const rows = db.query('SELECT id, history FROM conversations_v2').all() as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      try {
        const history = objectValue(JSON.parse(String(row['history'] ?? '{}')));
        return history ? parseKiroSessionObject(history, `${dbPath}:${stringValue(row['id']) ?? 'kiro-sqlite'}`, range) : [];
      } catch {
        warnings.push({ kind: 'parse', file: dbPath, count: 1 });
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export class KiroProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly baseDir: string;
  private readonly dbPaths: string[];

  constructor(baseDir?: string, dbPath?: string) {
    this.baseDir = baseDir ?? defaultBaseDir();
    this.dbPaths = dbPath ? [dbPath] : defaultDbPaths();
  }

  async isAvailable(): Promise<boolean> {
    return (existsSync(this.baseDir) && collectFiles(this.baseDir, isKiroFile).length > 0) ||
      this.dbPaths.some(existsSync);
  }

  async load(range: DateRange): Promise<ProviderData> {
    const warnings: ProviderWarning[] = [];
    const records = collectFiles(this.baseDir, isKiroFile).flatMap((file) => parseKiroFile(file, range));
    for (const dbPath of this.dbPaths) {
      records.push(...parseKiroSqlite(dbPath, range, warnings));
    }
    const turns = new Map<string, KiroUsageRecord>();
    for (const record of records) {
      const previous = turns.get(record.turnKey);
      if (!previous || Date.parse(record.timestamp) >= Date.parse(previous.timestamp)) {
        turns.set(record.turnKey, record);
      }
    }
    return buildProviderData(METADATA, [...turns.values()].filter((record) => isInRange(record.date, range)), warnings);
  }
}
