import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { isInRange } from '../utils';
import {
  buildProviderData,
  extractDate,
  safeNumber,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'crush';
const DISPLAY_NAME = 'Crush';
const COLORS: ProviderColors = {
  primary: '#ef4444',
  secondary: '#fca5a5',
  gradient: ['#ef4444', '#fca5a5'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

interface CrushSession {
  id: string;
  cost: number;
  created_at: number;
  updated_at: number;
}

function defaultRegistryPath(): string {
  return join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'crush', 'projects.json');
}

function discoverCrushDbs(): string[] {
  const override = process.env['TOKENLEAK_CRUSH_DIR'];
  if (override && existsSync(override)) {
    return override.endsWith('.db') ? [override] : [join(override, 'crush.db')].filter(existsSync);
  }

  const registryPath = defaultRegistryPath();
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const projects = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.projects) ? parsed.projects : [];
    return projects.flatMap((project: unknown) => {
      if (typeof project !== 'object' || project === null) return [];
      const p = project as Record<string, unknown>;
      const projectPath = stringValue(p['path']);
      const dataDir = stringValue(p['data_dir']) ?? '.crush';
      if (!projectPath) return [];
      const resolvedDir = isAbsolute(dataDir) ? dataDir : resolve(projectPath, dataDir);
      const db = join(resolvedDir, 'crush.db');
      return existsSync(db) ? [db] : [];
    });
  } catch {
    return [];
  }
}

function loadRows(dbPath: string): CrushSession[] {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return [];
  }
  try {
    return db.query(`
      SELECT id, cost, created_at, updated_at
      FROM sessions
      WHERE parent_session_id IS NULL
        AND (COALESCE(message_count, 0) > 0 OR COALESCE(cost, 0) > 0)
    `).all() as CrushSession[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function rowToRecord(dbPath: string, row: CrushSession, range: DateRange): LocalUsageRecord | null {
  const timestamp = timestampToIso(row.updated_at || row.created_at);
  const date = timestamp ? extractDate(timestamp) : null;
  if (!timestamp || !date || !isInRange(date, range)) return null;
  const cost = safeNumber(row.cost) ?? 0;
  if (cost <= 0) return null;
  return {
    date,
    timestamp,
    model: 'session-total',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    explicitCost: cost,
    sessionId: `${dbPath}:${row.id}`,
    projectId: dirname(dbPath).split(/[\\/]/).at(-1),
  };
}

export class CrushProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly dbPaths: string[];

  constructor(dbPaths?: string[]) {
    this.dbPaths = dbPaths ?? discoverCrushDbs();
  }

  async isAvailable(): Promise<boolean> {
    return this.dbPaths.some(existsSync);
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records = this.dbPaths.flatMap((dbPath) =>
      loadRows(dbPath)
        .map((row) => rowToRecord(dbPath, row, range))
        .filter((record): record is LocalUsageRecord => record !== null),
    );
    return buildProviderData(METADATA, records);
  }
}
