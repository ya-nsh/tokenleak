import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MenubarPaths } from './types.js';
import { MENUBAR_SCHEMA_VERSION, type ClaudeBridgeSnapshot, type StoredQuotaWindow } from './types.js';
import { writeClaudeBridgeSnapshot } from './state.js';

function toResetAtIso(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return null;
}

function parseWindow(value: unknown, fallbackMinutes: number): StoredQuotaWindow | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const usedPercent = record['used_percentage'] ?? record['usedPercent'] ?? record['used_percent'];
  const resetAt = record['resets_at'] ?? record['resetAt'] ?? record['reset_at'];
  const windowMinutes = record['window_minutes'] ?? record['windowMinutes'] ?? fallbackMinutes;

  if (typeof usedPercent !== 'number') {
    return null;
  }

  return {
    usedPercent,
    windowMinutes: typeof windowMinutes === 'number' ? windowMinutes : fallbackMinutes,
    resetAt: toResetAtIso(resetAt),
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

function debugLog(paths: MenubarPaths, message: string): void {
  try {
    const logPath = join(paths.logsDir, 'claude-statusline-debug.log');
    mkdirSync(dirname(logPath), { recursive: true });
    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch {
    // best-effort logging
  }
}

function extractRateLimits(root: Record<string, unknown>): {
  fiveHour: StoredQuotaWindow | null;
  sevenDay: StoredQuotaWindow | null;
} | null {
  // Try standard structure: { rate_limits: { five_hour: ..., seven_day: ... } }
  const rateLimits = root['rate_limits'] ?? root['rateLimits'];
  if (typeof rateLimits === 'object' && rateLimits !== null) {
    const rl = rateLimits as Record<string, unknown>;
    const fiveHour = parseWindow(rl['five_hour'] ?? rl['fiveHour'], 300);
    const sevenDay = parseWindow(rl['seven_day'] ?? rl['sevenDay'], 10080);
    // Also try primary/secondary (Codex-style naming)
    const primary = fiveHour ?? parseWindow(rl['primary'], 300);
    const secondary = sevenDay ?? parseWindow(rl['secondary'], 10080);
    if (primary || secondary) {
      return { fiveHour: primary, sevenDay: secondary };
    }
  }

  // Try top-level windows: { five_hour: ..., seven_day: ... }
  const topFive = parseWindow(root['five_hour'] ?? root['fiveHour'], 300);
  const topSeven = parseWindow(root['seven_day'] ?? root['sevenDay'], 10080);
  if (topFive || topSeven) {
    return { fiveHour: topFive, sevenDay: topSeven };
  }

  return null;
}

export async function recordClaudeStatuslineSnapshot(paths: MenubarPaths): Promise<boolean> {
  const input = (await readStdinText()).trim();
  if (!input) {
    debugLog(paths, 'Empty stdin — no data received');
    return false;
  }

  debugLog(paths, `Received ${input.length} bytes: ${input.slice(0, 500)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    debugLog(paths, `JSON parse error for input: ${input.slice(0, 200)}`);
    return false;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    debugLog(paths, 'Parsed value is not an object');
    return false;
  }

  const root = parsed as Record<string, unknown>;
  const result = extractRateLimits(root);

  if (!result || (!result.fiveHour && !result.sevenDay)) {
    debugLog(paths, `No rate limit windows found in keys: ${Object.keys(root).join(', ')}`);
    return false;
  }

  debugLog(paths, `Parsed OK — 5h: ${result.fiveHour?.usedPercent ?? '--'}%, 7d: ${result.sevenDay?.usedPercent ?? '--'}%`);

  const snapshot: ClaudeBridgeSnapshot = {
    schemaVersion: MENUBAR_SCHEMA_VERSION,
    source: 'claude-statusline',
    capturedAt: new Date().toISOString(),
    planType: resolvePlanType(root),
    fiveHour: result.fiveHour,
    sevenDay: result.sevenDay,
  };
  writeClaudeBridgeSnapshot(paths, snapshot);
  return true;
}
