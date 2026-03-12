import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Database } from 'bun:sqlite';
import type { DateRange, DailyUsage, ModelBreakdown, ProviderColors, ProviderData } from '@tokenleak/core';
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

interface SqliteRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string | number;
}

interface JsonMessage {
  model: string;
  role: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  created_at: string | number;
}

interface JsonSession {
  messages: JsonMessage[];
}

/**
 * Extracts a YYYY-MM-DD date string from a Unix timestamp (seconds) or ISO string.
 */
function extractDate(createdAt: string | number): string {
  if (typeof createdAt === 'number') {
    // Unix timestamp in seconds
    return new Date(createdAt * 1000).toISOString().slice(0, 10);
  }
  // Try parsing as number string first
  const asNum = Number(createdAt);
  if (!Number.isNaN(asNum) && String(asNum) === String(createdAt).trim()) {
    return new Date(asNum * 1000).toISOString().slice(0, 10);
  }
  // ISO string
  return new Date(createdAt).toISOString().slice(0, 10);
}

interface UsageRecord {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function buildProviderData(records: UsageRecord[]): ProviderData {
  // Group by date
  const byDate = new Map<string, Map<string, { inputTokens: number; outputTokens: number }>>();

  for (const record of records) {
    let dateMap = byDate.get(record.date);
    if (!dateMap) {
      dateMap = new Map();
      byDate.set(record.date, dateMap);
    }

    const normalized = normalizeModelName(record.model);
    const existing = dateMap.get(normalized);
    if (existing) {
      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
    } else {
      dateMap.set(normalized, {
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
      });
    }
  }

  let totalTokens = 0;
  let totalCost = 0;

  const daily: DailyUsage[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, modelMap]) => {
      const models: ModelBreakdown[] = [];
      let dayInput = 0;
      let dayOutput = 0;
      let dayCost = 0;

      for (const [model, usage] of modelMap) {
        const cost = estimateCost(model, usage.inputTokens, usage.outputTokens, 0, 0);
        const cacheReadTokens = 0;
        const cacheWriteTokens = 0;
        const modelTotal = usage.inputTokens + usage.outputTokens + cacheReadTokens + cacheWriteTokens;

        models.push({
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          totalTokens: modelTotal,
          cost,
        });

        dayInput += usage.inputTokens;
        dayOutput += usage.outputTokens;
        dayCost += cost;
      }

      const dayTotal = dayInput + dayOutput;
      totalTokens += dayTotal;
      totalCost += dayCost;

      return {
        date,
        inputTokens: dayInput,
        outputTokens: dayOutput,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
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
    // Database file is corrupted or inaccessible
    return [];
  }

  try {
    // Verify the expected schema exists before querying
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'",
    ).all() as { name: string }[];
    if (tables.length === 0) {
      return [];
    }

    const rows = db.query(
      'SELECT model, input_tokens, output_tokens, created_at FROM messages WHERE role = \'assistant\'',
    ).all() as SqliteRow[];

    const records: UsageRecord[] = [];
    for (const row of rows) {
      const date = extractDate(row.created_at);
      if (isInRange(date, range)) {
        records.push({
          date,
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
        });
      }
    }
    return records;
  } catch {
    // Incompatible schema or query error — return empty rather than crash
    return [];
  } finally {
    db.close();
  }
}

function loadFromJson(sessionsDir: string, range: DateRange): UsageRecord[] {
  const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  const records: UsageRecord[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(sessionsDir, file), 'utf-8');
      const session = JSON.parse(content) as JsonSession;

      if (!Array.isArray(session.messages)) {
        continue;
      }

      for (const msg of session.messages) {
        if (msg.role !== 'assistant' || !msg.usage) {
          continue;
        }

        const date = extractDate(msg.created_at);
        if (isInRange(date, range)) {
          records.push({
            date,
            model: msg.model,
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
          });
        }
      }
    } catch {
      // Skip files that fail to read or parse
      continue;
    }
  }

  return records;
}

export class OpenCodeProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), '.opencode');
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!existsSync(this.baseDir)) {
        return false;
      }
      const hasDb = existsSync(join(this.baseDir, 'sessions.db'));
      const hasSessionsDir = existsSync(join(this.baseDir, 'sessions'));
      return hasDb || hasSessionsDir;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const dbPath = join(this.baseDir, 'sessions.db');
    const sessionsDir = join(this.baseDir, 'sessions');

    let records: UsageRecord[];

    if (existsSync(dbPath)) {
      records = loadFromSqlite(dbPath, range);
    } else if (existsSync(sessionsDir)) {
      records = loadFromJson(sessionsDir, range);
    } else {
      records = [];
    }

    return buildProviderData(records);
  }
}
