import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Database } from 'bun:sqlite';
import type {
  DateRange,
  DailyUsage,
  ModelBreakdown,
  ProviderColors,
  ProviderData,
} from '@tokenleak/core';
import type { IProvider } from '../provider';
import { normalizeModelName } from '../models/normalizer';
import { estimateCost } from '../models/cost';
import { isInRange } from '../utils';

const PROVIDER_NAME = 'open-code';
const DISPLAY_NAME = 'Open Code';
const COLORS: ProviderColors = {
  primary: '#6366f1',
  secondary: '#a78bfa',
  gradient: ['#6366f1', '#a78bfa'],
};

const CURRENT_DEFAULT_BASE_DIR = join(homedir(), '.local', 'share', 'opencode');
const LEGACY_DEFAULT_BASE_DIR = join(homedir(), '.opencode');
const CONFIG_DEFAULT_BASE_DIR = join(homedir(), '.config', 'opencode');

interface SqliteRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string | number;
}

interface LegacyJsonMessage {
  model: string;
  role: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  created_at: string | number;
}

interface LegacyJsonSession {
  messages: LegacyJsonMessage[];
}

interface CurrentJsonMessage {
  id?: string;
  role?: string;
  modelID?: string;
  cost?: number;
  time?: {
    created?: string | number;
  };
  tokens?: {
    input?: number;
    output?: number;
    cache?: {
      read?: number;
      write?: number;
    };
  };
}

interface UsageRecord {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  explicitCost?: number;
}

function resolveBaseDir(baseDir?: string): string {
  if (baseDir) {
    return baseDir;
  }

  for (const candidate of [
    CURRENT_DEFAULT_BASE_DIR,
    LEGACY_DEFAULT_BASE_DIR,
    CONFIG_DEFAULT_BASE_DIR,
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return CURRENT_DEFAULT_BASE_DIR;
}

function extractDate(createdAt: string | number): string | null {
  const timestamp =
    typeof createdAt === 'number'
      ? createdAt
      : Number.isNaN(Number(createdAt))
        ? Date.parse(createdAt)
        : Number(createdAt);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const millis = Math.abs(timestamp) >= 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(millis);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function getRecordCost(record: UsageRecord): number {
  if (typeof record.explicitCost === 'number' && Number.isFinite(record.explicitCost)) {
    return record.explicitCost;
  }

  return estimateCost(
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
  );
}

function buildProviderData(records: UsageRecord[]): ProviderData {
  const byDate = new Map<string, Map<string, ModelBreakdown>>();

  for (const record of records) {
    let dateMap = byDate.get(record.date);
    if (!dateMap) {
      dateMap = new Map();
      byDate.set(record.date, dateMap);
    }

    const normalized = normalizeModelName(record.model);
    const existing = dateMap.get(normalized);
    const recordCost = getRecordCost(record);

    if (existing) {
      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
      existing.cacheReadTokens += record.cacheReadTokens;
      existing.cacheWriteTokens += record.cacheWriteTokens;
      existing.totalTokens +=
        record.inputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens;
      existing.cost += recordCost;
    } else {
      dateMap.set(normalized, {
        model: normalized,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheReadTokens: record.cacheReadTokens,
        cacheWriteTokens: record.cacheWriteTokens,
        totalTokens:
          record.inputTokens +
          record.outputTokens +
          record.cacheReadTokens +
          record.cacheWriteTokens,
        cost: recordCost,
      });
    }
  }

  let totalTokens = 0;
  let totalCost = 0;

  const daily: DailyUsage[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, modelMap]) => {
      const models = [...modelMap.values()];
      const inputTokens = models.reduce((sum, model) => sum + model.inputTokens, 0);
      const outputTokens = models.reduce((sum, model) => sum + model.outputTokens, 0);
      const cacheReadTokens = models.reduce((sum, model) => sum + model.cacheReadTokens, 0);
      const cacheWriteTokens = models.reduce((sum, model) => sum + model.cacheWriteTokens, 0);
      const dayTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
      const dayCost = models.reduce((sum, model) => sum + model.cost, 0);

      totalTokens += dayTotal;
      totalCost += dayCost;

      return {
        date,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens: dayTotal,
        cost: dayCost,
        models,
      };
    });

  return {
    provider: PROVIDER_NAME,
    displayName: DISPLAY_NAME,
    daily,
    totalTokens,
    totalCost,
    colors: COLORS,
  };
}

function loadFromSqlite(dbPath: string, range: DateRange): UsageRecord[] {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return [];
  }

  try {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
      .all() as { name: string }[];
    if (tables.length === 0) {
      return [];
    }

    const rows = db
      .query(
        "SELECT model, input_tokens, output_tokens, created_at FROM messages WHERE role = 'assistant'",
      )
      .all() as SqliteRow[];

    const records: UsageRecord[] = [];
    for (const row of rows) {
      const date = extractDate(row.created_at);
      if (date && isInRange(date, range)) {
        records.push({
          date,
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        });
      }
    }
    return records;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function loadFromLegacyJson(sessionsDir: string, range: DateRange): UsageRecord[] {
  const files = readdirSync(sessionsDir).filter((file) => file.endsWith('.json'));
  const records: UsageRecord[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(sessionsDir, file), 'utf-8');
      const session = JSON.parse(content) as LegacyJsonSession;

      if (!Array.isArray(session.messages)) {
        continue;
      }

      for (const msg of session.messages) {
        if (msg.role !== 'assistant' || !msg.usage) {
          continue;
        }

        const date = extractDate(msg.created_at);
        if (date && isInRange(date, range)) {
          records.push({
            date,
            model: msg.model,
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          });
        }
      }
    } catch {
      continue;
    }
  }

  return records;
}

function loadFromCurrentStorage(baseDir: string, range: DateRange): UsageRecord[] {
  const messagesRoot = join(baseDir, 'storage', 'message');
  if (!existsSync(messagesRoot)) {
    return [];
  }

  const recordsById = new Map<string, UsageRecord>();
  const recordsWithoutId: UsageRecord[] = [];

  for (const sessionDir of readdirSync(messagesRoot)) {
    const sessionPath = join(messagesRoot, sessionDir);

    let messageFiles: string[];
    try {
      messageFiles = readdirSync(sessionPath).filter((file) => file.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of messageFiles) {
      try {
        const content = readFileSync(join(sessionPath, file), 'utf-8');
        const message = JSON.parse(content) as CurrentJsonMessage;

        if (message.role !== 'assistant') {
          continue;
        }

        const model = message.modelID;
        const createdAt = message.time?.created;
        if (
          typeof model !== 'string' ||
          (typeof createdAt !== 'string' && typeof createdAt !== 'number')
        ) {
          continue;
        }

        const date = extractDate(createdAt);
        if (!date || !isInRange(date, range)) {
          continue;
        }

        const inputTokens = typeof message.tokens?.input === 'number' ? message.tokens.input : 0;
        const outputTokens = typeof message.tokens?.output === 'number' ? message.tokens.output : 0;
        const cacheReadTokens =
          typeof message.tokens?.cache?.read === 'number' ? message.tokens.cache.read : 0;
        const cacheWriteTokens =
          typeof message.tokens?.cache?.write === 'number' ? message.tokens.cache.write : 0;

        const record: UsageRecord = {
          date,
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          explicitCost: typeof message.cost === 'number' ? message.cost : undefined,
        };

        const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
        if (
          totalTokens === 0 &&
          !(typeof record.explicitCost === 'number' && record.explicitCost > 0)
        ) {
          continue;
        }

        if (typeof message.id === 'string' && message.id.length > 0) {
          recordsById.set(message.id, record);
        } else {
          recordsWithoutId.push(record);
        }
      } catch {
        continue;
      }
    }
  }

  return [...recordsById.values(), ...recordsWithoutId];
}

export class OpenCodeProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!existsSync(this.baseDir)) {
        return false;
      }

      const hasCurrentStorage = existsSync(join(this.baseDir, 'storage', 'message'));
      const hasLegacyDb =
        existsSync(join(this.baseDir, 'opencode.db')) ||
        existsSync(join(this.baseDir, 'sessions.db'));
      const hasLegacySessionsDir = existsSync(join(this.baseDir, 'sessions'));

      return hasCurrentStorage || hasLegacyDb || hasLegacySessionsDir;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const currentMessagesRoot = join(this.baseDir, 'storage', 'message');
    if (existsSync(currentMessagesRoot)) {
      const currentRecords = loadFromCurrentStorage(this.baseDir, range);
      return buildProviderData(currentRecords);
    }

    const opencodeDbPath = join(this.baseDir, 'opencode.db');
    const sessionsDbPath = join(this.baseDir, 'sessions.db');
    const sessionsDir = join(this.baseDir, 'sessions');

    let records: UsageRecord[] = [];

    if (existsSync(opencodeDbPath)) {
      records = loadFromSqlite(opencodeDbPath, range);
    } else if (existsSync(sessionsDbPath)) {
      records = loadFromSqlite(sessionsDbPath, range);
    } else if (existsSync(sessionsDir)) {
      records = loadFromLegacyJson(sessionsDir, range);
    }

    return buildProviderData(records);
  }
}
