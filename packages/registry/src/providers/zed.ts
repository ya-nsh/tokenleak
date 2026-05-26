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

const PROVIDER_NAME = 'zed';
const DISPLAY_NAME = 'Zed Agent';
const ZED_HOSTED_PROVIDER = 'zed.dev';
const COLORS: ProviderColors = {
  primary: '#0891b2',
  secondary: '#22d3ee',
  gradient: ['#0891b2', '#22d3ee'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

interface ZedRow {
  id: string;
  updated_at: string;
  folder_paths?: string | null;
  folder_paths_order?: string | null;
  data_type: string;
  data: Uint8Array | Buffer;
}

function defaultDbPaths(): string[] {
  const override = process.env['TOKENLEAK_ZED_DIR'];
  if (override) {
    return override.endsWith('.db')
      ? [override]
      : [join(override, 'threads', 'threads.db'), join(override, 'threads.db')];
  }
  const paths = [
    join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'zed', 'threads', 'threads.db'),
    join(homedir(), 'Library', 'Application Support', 'Zed', 'threads', 'threads.db'),
  ];
  if (process.env['LOCALAPPDATA']) {
    paths.push(join(process.env['LOCALAPPDATA'], 'Zed', 'threads', 'threads.db'));
  }
  return paths;
}

function loadRows(dbPath: string): ZedRow[] {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return [];
  }
  try {
    return db.query('SELECT id, updated_at, folder_paths, folder_paths_order, data_type, data FROM threads').all() as ZedRow[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function decodeData(row: ZedRow): Record<string, unknown> | null {
  if (row.data_type.toLowerCase() !== 'json') return null;
  try {
    return objectValue(JSON.parse(Buffer.from(row.data).toString('utf-8')));
  } catch {
    return null;
  }
}

function projectFromFolders(folderPaths?: string | null): string | undefined {
  if (!folderPaths) return undefined;
  try {
    const folders = JSON.parse(folderPaths);
    if (!Array.isArray(folders)) return undefined;
    const first = stringValue(folders[0]);
    return first?.split(/[\\/]/).filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}

function usageFromThread(thread: Record<string, unknown>): Record<string, unknown> | null {
  return objectValue(thread['usage']) ?? objectValue(thread['token_usage']) ?? objectValue(thread['usageData']);
}

function rowToRecord(row: ZedRow, range: DateRange): LocalUsageRecord | null {
  const thread = decodeData(row);
  if (!thread || thread['imported'] === true) return null;
  const modelObj = objectValue(thread['model']);
  if ((stringValue(modelObj?.['provider']) ?? '').toLowerCase() !== ZED_HOSTED_PROVIDER) return null;
  const model = stringValue(modelObj?.['model']) ?? stringValue(modelObj?.['id']);
  if (!model) return null;
  const usage = usageFromThread(thread);
  if (!usage) return null;
  const timestamp = timestampToIso(thread['updated_at']) ?? timestampToIso(row.updated_at);
  const date = timestamp ? extractDate(timestamp) : null;
  if (!timestamp || !date || !isInRange(date, range)) return null;
  const inputTokens = nonNegativeNumber(usage['input_tokens'] ?? usage['input']);
  const outputTokens = nonNegativeNumber(usage['output_tokens'] ?? usage['output']) + nonNegativeNumber(usage['reasoning_tokens']);
  const cacheReadTokens = nonNegativeNumber(usage['cache_read_tokens'] ?? usage['cacheRead']);
  const cacheWriteTokens = nonNegativeNumber(usage['cache_write_tokens'] ?? usage['cacheWrite']);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;
  return {
    date,
    timestamp,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    sessionId: row.id,
    projectId: projectFromFolders(row.folder_paths),
  };
}

export class ZedProvider implements IProvider {
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
      .map((row) => rowToRecord(row, range))
      .filter((record): record is LocalUsageRecord => record !== null);
    return buildProviderData(METADATA, records);
  }
}
