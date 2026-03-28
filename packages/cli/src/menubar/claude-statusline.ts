import type { MenubarPaths } from './types.js';
import { MENUBAR_SCHEMA_VERSION, type ClaudeBridgeSnapshot, type StoredQuotaWindow } from './types.js';
import { writeClaudeBridgeSnapshot } from './state.js';

function parseWindow(value: unknown, fallbackMinutes: number): StoredQuotaWindow | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const usedPercent = record['used_percentage'] ?? record['usedPercent'];
  const resetAt = record['resets_at'] ?? record['resetAt'];
  const windowMinutes = record['window_minutes'] ?? record['windowMinutes'] ?? fallbackMinutes;

  if (typeof usedPercent !== 'number') {
    return null;
  }

  return {
    usedPercent,
    windowMinutes: typeof windowMinutes === 'number' ? windowMinutes : fallbackMinutes,
    resetAt: typeof resetAt === 'string' ? resetAt : null,
  };
}

function resolvePlanType(record: Record<string, unknown>): string | null {
  const candidates = [
    record['subscription_type'],
    record['subscriptionType'],
    record['plan_type'],
    typeof record['account'] === 'object' && record['account'] !== null
      ? (record['account'] as Record<string, unknown>)['subscription_type']
      : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

export async function recordClaudeStatuslineSnapshot(paths: MenubarPaths): Promise<boolean> {
  const input = (await readStdinText()).trim();
  if (!input) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return false;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }

  const root = parsed as Record<string, unknown>;
  const rateLimits = root['rate_limits'] ?? root['rateLimits'];
  if (typeof rateLimits !== 'object' || rateLimits === null) {
    return false;
  }

  const rateLimitsRecord = rateLimits as Record<string, unknown>;
  const fiveHour =
    parseWindow(rateLimitsRecord['five_hour'] ?? rateLimitsRecord['fiveHour'], 300);
  const sevenDay =
    parseWindow(rateLimitsRecord['seven_day'] ?? rateLimitsRecord['sevenDay'], 10080);

  if (!fiveHour && !sevenDay) {
    return false;
  }

  const snapshot: ClaudeBridgeSnapshot = {
    schemaVersion: MENUBAR_SCHEMA_VERSION,
    source: 'claude-statusline',
    capturedAt: new Date().toISOString(),
    planType: resolvePlanType(root),
    fiveHour,
    sevenDay,
  };
  writeClaudeBridgeSnapshot(paths, snapshot);
  return true;
}
