import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { QuotaWindowSnapshot } from './codex-rate-limits';

export { type QuotaWindowSnapshot } from './codex-rate-limits';

const SCHEMA_VERSION = 1;

export interface ClaudeQuotaSnapshot {
  provider: 'claude-code';
  capturedAt: string;
  planType: string | null;
  fiveHour: QuotaWindowSnapshot | null;
  sevenDay: QuotaWindowSnapshot | null;
}

function resolveDefaultSnapshotPath(): string {
  return join(
    homedir(),
    'Library',
    'Application Support',
    'tokenleak',
    'menubar',
    'claude-rate-limits.json',
  );
}

function toResetAtIso(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  return null;
}

function parseStoredWindow(
  value: unknown,
  fallbackMinutes: number,
): QuotaWindowSnapshot | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const usedPercent = record['usedPercent'] ?? record['used_percent'] ?? record['used_percentage'];
  const windowMinutes = record['windowMinutes'] ?? record['window_minutes'] ?? fallbackMinutes;
  const resetAt = record['resetAt'] ?? record['reset_at'] ?? record['resets_at'];

  if (typeof usedPercent !== 'number') {
    return null;
  }

  return {
    usedPercent,
    windowMinutes: typeof windowMinutes === 'number' ? windowMinutes : fallbackMinutes,
    resetAt: toResetAtIso(resetAt),
  };
}

export function extractClaudeQuotaSnapshot(
  snapshotPath: string = resolveDefaultSnapshotPath(),
): ClaudeQuotaSnapshot | null {
  if (!existsSync(snapshotPath)) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const root = raw as Record<string, unknown>;
  if (typeof root['schemaVersion'] === 'number' && root['schemaVersion'] > SCHEMA_VERSION) {
    return null;
  }

  const capturedAt = root['capturedAt'];
  if (typeof capturedAt !== 'string' || capturedAt.length === 0) {
    return null;
  }

  const fiveHour = parseStoredWindow(root['fiveHour'], 300);
  const sevenDay = parseStoredWindow(root['sevenDay'], 10080);

  if (!fiveHour && !sevenDay) {
    return null;
  }

  const planType = typeof root['planType'] === 'string' ? root['planType'] : null;

  return {
    provider: 'claude-code',
    capturedAt,
    planType,
    fiveHour,
    sevenDay,
  };
}
