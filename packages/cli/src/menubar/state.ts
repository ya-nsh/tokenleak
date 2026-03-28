import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  extractCodexQuotaSnapshot,
  type CodexQuotaSnapshot,
  type QuotaWindowSnapshot,
} from '@tokenleak/registry';
import type {
  ClaudeBridgeSnapshot,
  MenubarConfig,
  MenubarPaths,
  MenubarProviderSnapshot,
  MenubarSnapshot,
  MenubarWindowSnapshot,
  StoredQuotaWindow,
} from './types.js';
import {
  CLAUDE_STATUSLINE_SETUP_MESSAGE,
  DEFAULT_MENUBAR_POLL_INTERVAL_SECONDS,
  MENUBAR_SCHEMA_VERSION,
} from './types.js';
import { toRemainingPercent } from './format.js';

const WINDOW_STALE_GRACE_MS = 5 * 60 * 1000;

function createEmptyWindow(label: string, windowMinutes: number): MenubarWindowSnapshot {
  return {
    label,
    usedPercent: null,
    resetAt: null,
    windowMinutes,
    isStale: false,
  };
}

function toMenubarWindow(
  label: string,
  value: QuotaWindowSnapshot | StoredQuotaWindow | null,
  nowMs: number,
  fallbackMinutes: number,
): MenubarWindowSnapshot {
  if (!value) {
    return createEmptyWindow(label, fallbackMinutes);
  }

  const resetMs = value.resetAt ? Date.parse(value.resetAt) : Number.NaN;
  const isStale = Number.isFinite(resetMs) ? nowMs > resetMs + WINDOW_STALE_GRACE_MS : false;

  return {
    label,
    usedPercent: value.usedPercent,
    resetAt: value.resetAt,
    windowMinutes: value.windowMinutes,
    isStale,
  };
}

function createProviderSnapshot(
  base: Omit<MenubarProviderSnapshot, 'windows'>,
  fiveHour: MenubarWindowSnapshot,
  sevenDay: MenubarWindowSnapshot,
): MenubarProviderSnapshot {
  return {
    ...base,
    windows: {
      fiveHour,
      sevenDay,
    },
  };
}

function buildCodexSnapshot(
  snapshot: CodexQuotaSnapshot | null,
  error: string | null,
  nowMs: number,
): MenubarProviderSnapshot {
  const fiveHour = toMenubarWindow('5h', snapshot?.fiveHour ?? null, nowMs, 300);
  const sevenDay = toMenubarWindow('7d', snapshot?.sevenDay ?? null, nowMs, 10080);

  if (error) {
    return createProviderSnapshot(
      {
        label: 'Codex',
        shortLabel: 'Cdx',
        source: 'codex-log',
        state: 'error',
        planType: null,
        lastUpdatedAt: null,
        message: error,
      },
      fiveHour,
      sevenDay,
    );
  }

  if (!snapshot) {
    return createProviderSnapshot(
      {
        label: 'Codex',
        shortLabel: 'Cdx',
        source: 'codex-log',
        state: 'setup_required',
        planType: null,
        lastUpdatedAt: null,
        message: 'Use Codex once to generate a local quota snapshot.',
      },
      fiveHour,
      sevenDay,
    );
  }

  const state = fiveHour.isStale && sevenDay.isStale ? 'stale' : 'ready';
  return createProviderSnapshot(
    {
      label: 'Codex',
      shortLabel: 'Cdx',
      source: 'codex-log',
      state,
      planType: snapshot.planType,
      lastUpdatedAt: snapshot.capturedAt,
      message: state === 'stale' ? 'Codex quota data is older than the last reset.' : null,
    },
    fiveHour,
    sevenDay,
  );
}

function buildClaudeSnapshot(
  snapshot: ClaudeBridgeSnapshot | null,
  error: string | null,
  config: MenubarConfig,
  nowMs: number,
): MenubarProviderSnapshot {
  const fiveHour = toMenubarWindow('5h', snapshot?.fiveHour ?? null, nowMs, 300);
  const sevenDay = toMenubarWindow('7d', snapshot?.sevenDay ?? null, nowMs, 10080);

  if (error) {
    return createProviderSnapshot(
      {
        label: 'Claude Code',
        shortLabel: 'Cld',
        source: 'claude-statusline',
        state: 'error',
        planType: null,
        lastUpdatedAt: null,
        message: error,
      },
      fiveHour,
      sevenDay,
    );
  }

  if (!snapshot) {
    return createProviderSnapshot(
      {
        label: 'Claude Code',
        shortLabel: 'Cld',
        source: 'claude-statusline',
        state: config.claudeStatusLineManaged ? 'waiting_for_first_snapshot' : 'setup_required',
        planType: null,
        lastUpdatedAt: null,
        message: config.claudeStatusLineManaged
          ? CLAUDE_STATUSLINE_SETUP_MESSAGE
          : 'Claude Code statusline bridge is not configured.',
      },
      fiveHour,
      sevenDay,
    );
  }

  const state = fiveHour.isStale && sevenDay.isStale ? 'stale' : 'ready';
  return createProviderSnapshot(
    {
      label: 'Claude Code',
      shortLabel: 'Cld',
      source: 'claude-statusline',
      state,
      planType: snapshot.planType,
      lastUpdatedAt: snapshot.capturedAt,
      message: state === 'stale' ? 'Claude quota data is older than the last reset.' : null,
    },
    fiveHour,
    sevenDay,
  );
}

function titlePercent(provider: MenubarProviderSnapshot): string {
  const value = provider.windows.fiveHour;
  if (provider.state !== 'ready' || value.isStale || typeof value.usedPercent !== 'number') {
    return '--';
  }

  const remaining = toRemainingPercent(value.usedPercent);
  return typeof remaining === 'number' ? `${Math.round(remaining)}%` : '--';
}

export function ensureMenubarDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeJsonAtomic(path: string, value: unknown): void {
  ensureMenubarDir(dirname(path));
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmpPath, path);
}

export function writeExecutableScript(path: string, content: string): void {
  ensureMenubarDir(dirname(path));
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

export function readMenubarConfig(paths: MenubarPaths): MenubarConfig {
  if (!existsSync(paths.configPath)) {
    return createDefaultMenubarConfig();
  }

  const raw = JSON.parse(readFileSync(paths.configPath, 'utf8')) as Partial<MenubarConfig>;
  return {
    schemaVersion: MENUBAR_SCHEMA_VERSION,
    pollIntervalSeconds:
      typeof raw.pollIntervalSeconds === 'number' && raw.pollIntervalSeconds >= 10
        ? Math.round(raw.pollIntervalSeconds)
        : DEFAULT_MENUBAR_POLL_INTERVAL_SECONDS,
    claudeStatusLineManaged: raw.claudeStatusLineManaged === true,
    claudeStatusLineBackup: raw.claudeStatusLineBackup ?? null,
  };
}

export function createDefaultMenubarConfig(): MenubarConfig {
  return {
    schemaVersion: MENUBAR_SCHEMA_VERSION,
    pollIntervalSeconds: DEFAULT_MENUBAR_POLL_INTERVAL_SECONDS,
    claudeStatusLineManaged: false,
    claudeStatusLineBackup: null,
  };
}

export function writeMenubarConfig(paths: MenubarPaths, config: MenubarConfig): void {
  writeJsonAtomic(paths.configPath, config);
}

export function readSnapshot(paths: MenubarPaths): MenubarSnapshot | null {
  if (!existsSync(paths.snapshotPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(paths.snapshotPath, 'utf8')) as MenubarSnapshot;
  } catch {
    return null;
  }
}

export function readClaudeBridgeSnapshot(paths: MenubarPaths): ClaudeBridgeSnapshot | null {
  if (!existsSync(paths.claudeSnapshotPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(paths.claudeSnapshotPath, 'utf8')) as ClaudeBridgeSnapshot;
  } catch {
    return null;
  }
}

export function writeClaudeBridgeSnapshot(
  paths: MenubarPaths,
  snapshot: ClaudeBridgeSnapshot,
): void {
  writeJsonAtomic(paths.claudeSnapshotPath, snapshot);
}

export function writeSnapshot(paths: MenubarPaths, snapshot: MenubarSnapshot): void {
  writeJsonAtomic(paths.snapshotPath, snapshot);
}

export async function refreshMenubarSnapshot(paths: MenubarPaths): Promise<MenubarSnapshot> {
  const config = readMenubarConfig(paths);
  const now = new Date();
  const nowMs = now.getTime();

  let codexSnapshot: CodexQuotaSnapshot | null = null;
  let codexError: string | null = null;
  try {
    codexSnapshot = await extractCodexQuotaSnapshot();
  } catch (error: unknown) {
    codexError = error instanceof Error ? error.message : String(error);
  }

  let claudeSnapshot: ClaudeBridgeSnapshot | null = null;
  let claudeError: string | null = null;
  try {
    claudeSnapshot = readClaudeBridgeSnapshot(paths);
  } catch (error: unknown) {
    claudeError = error instanceof Error ? error.message : String(error);
  }

  const codex = buildCodexSnapshot(codexSnapshot, codexError, nowMs);
  const claudeCode = buildClaudeSnapshot(claudeSnapshot, claudeError, config, nowMs);
  const snapshot: MenubarSnapshot = {
    schemaVersion: MENUBAR_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    title: `${codex.shortLabel} ${titlePercent(codex)} | ${claudeCode.shortLabel} ${titlePercent(
      claudeCode,
    )}`,
    providers: {
      codex,
      claudeCode,
    },
  };

  writeSnapshot(paths, snapshot);
  return snapshot;
}

export function clearMenubarState(paths: MenubarPaths): void {
  rmSync(paths.snapshotPath, { force: true });
  rmSync(paths.claudeSnapshotPath, { force: true });
}
