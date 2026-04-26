import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { splitJsonlRecords } from '../parsers/jsonl-splitter';

function resolveDefaultSessionsDir(): string {
  return join(process.env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'sessions');
}

export interface QuotaWindowSnapshot {
  usedPercent: number;
  windowMinutes: number;
  resetAt: string | null;
}

export interface CodexQuotaSnapshot {
  provider: 'codex';
  capturedAt: string;
  planType: string | null;
  fiveHour: QuotaWindowSnapshot | null;
  sevenDay: QuotaWindowSnapshot | null;
}

interface ParsedCodexQuotaSnapshot {
  capturedAt: string;
  planType: string | null;
  fiveHour: QuotaWindowSnapshot | null;
  sevenDay: QuotaWindowSnapshot | null;
}

function collectJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectJsonlFiles(fullPath));
    } else if (entry.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }

  return files;
}

function toResetAtIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function parseQuotaWindow(value: unknown): QuotaWindowSnapshot | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const usedPercent = record['used_percent'];
  const windowMinutes = record['window_minutes'];

  if (typeof usedPercent !== 'number' || typeof windowMinutes !== 'number') {
    return null;
  }

  return {
    usedPercent,
    windowMinutes,
    resetAt: toResetAtIso(record['resets_at']),
  };
}

function parseQuotaSnapshot(record: unknown): ParsedCodexQuotaSnapshot | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const root = record as Record<string, unknown>;
  if (root['type'] !== 'event_msg') {
    return null;
  }

  const timestamp = root['timestamp'];
  const payload = root['payload'];
  if (typeof timestamp !== 'string' || typeof payload !== 'object' || payload === null) {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord['type'] !== 'token_count') {
    return null;
  }

  const rateLimits = payloadRecord['rate_limits'];
  if (typeof rateLimits !== 'object' || rateLimits === null) {
    return null;
  }

  const limits = rateLimits as Record<string, unknown>;
  const fiveHour = parseQuotaWindow(limits['primary']);
  const sevenDay = parseQuotaWindow(limits['secondary']);

  if (!fiveHour && !sevenDay) {
    return null;
  }

  return {
    capturedAt: timestamp,
    planType: typeof limits['plan_type'] === 'string' ? limits['plan_type'] : null,
    fiveHour,
    sevenDay,
  };
}

export async function extractCodexQuotaSnapshot(
  baseDir: string = resolveDefaultSessionsDir(),
): Promise<CodexQuotaSnapshot | null> {
  const files = collectJsonlFiles(baseDir);
  let latest: ParsedCodexQuotaSnapshot | null = null;

  for (const file of files) {
    try {
      for await (const record of splitJsonlRecords(file)) {
        const parsed = parseQuotaSnapshot(record);
        if (!parsed) {
          continue;
        }

        if (!latest || parsed.capturedAt > latest.capturedAt) {
          latest = parsed;
        }
      }
    } catch {
      continue;
    }
  }

  if (!latest) {
    return null;
  }

  return {
    provider: 'codex',
    capturedAt: latest.capturedAt,
    planType: latest.planType,
    fiveHour: latest.fiveHour,
    sevenDay: latest.sevenDay,
  };
}
