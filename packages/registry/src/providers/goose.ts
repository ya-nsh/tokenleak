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
  objectValue,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'goose';
const DISPLAY_NAME = 'Goose';
const COLORS: ProviderColors = {
  primary: '#0f766e',
  secondary: '#5eead4',
  gradient: ['#0f766e', '#5eead4'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

interface GooseRow {
  id: string;
  model_config_json?: string | null;
  provider_name?: string | null;
  created_at: string;
  total_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  accumulated_total_tokens?: number | null;
  accumulated_input_tokens?: number | null;
  accumulated_output_tokens?: number | null;
}

function defaultDbPaths(): string[] {
  const override = process.env['TOKENLEAK_GOOSE_DIR'] ?? process.env['GOOSE_PATH_ROOT'];
  if (override) return [override.endsWith('.db') ? override : join(override, 'sessions', 'sessions.db')];
  return [
    join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'goose', 'sessions', 'sessions.db'),
    join(homedir(), 'Library', 'Application Support', 'goose', 'sessions', 'sessions.db'),
    join(homedir(), 'Library', 'Application Support', 'Block', 'goose', 'sessions', 'sessions.db'),
    join(homedir(), '.local', 'share', 'Block', 'goose', 'sessions', 'sessions.db'),
  ];
}

function loadRows(dbPath: string): GooseRow[] {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return [];
  }
  try {
    return db.query('SELECT * FROM sessions').all() as GooseRow[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function rowToRecord(row: GooseRow, range: DateRange): LocalUsageRecord | null {
  const config = objectValue(row.model_config_json ? JSON.parse(row.model_config_json) : null);
  const model = stringValue(config?.['model_name']);
  if (!model) return null;
  const timestamp = timestampToIso(row.created_at);
  const date = timestamp ? extractDate(timestamp) : null;
  if (!timestamp || !date || !isInRange(date, range)) return null;
  const inputTokens = nonNegativeNumber(row.accumulated_input_tokens ?? row.input_tokens);
  const baseOutput = nonNegativeNumber(row.accumulated_output_tokens ?? row.output_tokens);
  const total = nonNegativeNumber(row.accumulated_total_tokens ?? row.total_tokens);
  const outputTokens = baseOutput + Math.max(0, total - inputTokens - baseOutput);
  if (inputTokens + outputTokens === 0) return null;
  return {
    date,
    timestamp,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sessionId: row.id,
    projectId: stringValue(row.provider_name) ?? undefined,
  };
}

export class GooseProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly dbPaths: string[];

  constructor(dbPath?: string) {
    this.dbPaths = dbPath ? [dbPath] : defaultDbPaths();
  }

  async isAvailable(): Promise<boolean> {
    return this.dbPaths.some(existsSync);
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records = this.dbPaths.flatMap((dbPath) => loadRows(dbPath))
      .map((row) => {
        try {
          return rowToRecord(row, range);
        } catch {
          return null;
        }
      })
      .filter((record): record is LocalUsageRecord => record !== null);
    return buildProviderData(METADATA, records);
  }
}
