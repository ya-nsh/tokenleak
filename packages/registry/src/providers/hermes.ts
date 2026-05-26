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

const PROVIDER_NAME = 'hermes';
const DISPLAY_NAME = 'Hermes';
const COLORS: ProviderColors = {
  primary: '#16a34a',
  secondary: '#86efac',
  gradient: ['#16a34a', '#86efac'],
};
const METADATA: LocalProviderMetadata = {
  provider: PROVIDER_NAME,
  displayName: DISPLAY_NAME,
  colors: COLORS,
};

interface HermesRow {
  id: string;
  model: string;
  billing_provider?: string | null;
  started_at: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  reasoning_tokens?: number | null;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
}

function tableColumns(db: InstanceType<typeof Database>, table: string): Set<string> {
  try {
    return new Set(
      (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
  } catch {
    return new Set();
  }
}

function selectColumn(columns: Set<string>, name: keyof HermesRow, fallback: string = 'NULL'): string {
  return columns.has(name) ? name : `${fallback} AS ${name}`;
}

function signalPredicate(columns: Set<string>): string {
  const tokenColumns = [
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'reasoning_tokens',
  ].filter((name) => columns.has(name));
  const predicates = tokenColumns.map((name) => `COALESCE(${name}, 0) > 0`);
  if (columns.has('actual_cost_usd') || columns.has('estimated_cost_usd')) {
    const actual = columns.has('actual_cost_usd') ? 'actual_cost_usd' : 'NULL';
    const estimated = columns.has('estimated_cost_usd') ? 'estimated_cost_usd' : 'NULL';
    predicates.push(`COALESCE(${actual}, ${estimated}, 0) > 0`);
  }

  return predicates.length > 0 ? predicates.join(' OR ') : '0';
}

function resolveDbPath(dbPath?: string): string {
  if (dbPath) {
    return dbPath;
  }

  if (process.env['TOKENLEAK_HERMES_DIR']) {
    return join(process.env['TOKENLEAK_HERMES_DIR'], 'state.db');
  }

  return join(process.env['HERMES_HOME'] ?? join(homedir(), '.hermes'), 'state.db');
}

function loadRows(dbPath: string): HermesRow[] {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return [];
  }

  try {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all() as { name: string }[];
    if (tables.length === 0) {
      return [];
    }

    const columns = tableColumns(db, 'sessions');
    return db
      .query(`
        SELECT
          id,
          model,
          ${selectColumn(columns, 'billing_provider')},
          started_at,
          ${selectColumn(columns, 'input_tokens', '0')},
          ${selectColumn(columns, 'output_tokens', '0')},
          ${selectColumn(columns, 'cache_read_tokens', '0')},
          ${selectColumn(columns, 'cache_write_tokens', '0')},
          ${selectColumn(columns, 'reasoning_tokens', '0')},
          ${selectColumn(columns, 'estimated_cost_usd')},
          ${selectColumn(columns, 'actual_cost_usd')}
        FROM sessions
        WHERE model IS NOT NULL
          AND TRIM(model) != ''
          AND (${signalPredicate(columns)})
      `)
      .all() as HermesRow[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function rowToRecord(row: HermesRow, range: DateRange): LocalUsageRecord | null {
  const timestamp = timestampToIso(row.started_at);
  const date = timestamp ? extractDate(timestamp) : null;
  if (!timestamp || !date || !isInRange(date, range)) {
    return null;
  }

  const inputTokens = nonNegativeNumber(row.input_tokens);
  const outputTokens =
    nonNegativeNumber(row.output_tokens) +
    nonNegativeNumber(row.reasoning_tokens);
  const cacheReadTokens = nonNegativeNumber(row.cache_read_tokens);
  const cacheWriteTokens = nonNegativeNumber(row.cache_write_tokens);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) {
    return null;
  }

  return {
    date,
    timestamp,
    model: stringValue(row.model) ?? 'unknown',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    explicitCost: safeNumber(row.actual_cost_usd) ?? safeNumber(row.estimated_cost_usd) ?? undefined,
    sessionId: row.id,
    projectId: stringValue(row.billing_provider) ?? undefined,
  };
}

export class HermesProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = resolveDbPath(dbPath);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.dbPath);
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records = loadRows(this.dbPath)
      .map((row) => rowToRecord(row, range))
      .filter((record): record is LocalUsageRecord => record !== null);

    return buildProviderData(METADATA, records);
  }
}
