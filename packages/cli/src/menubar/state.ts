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
  extractClaudeQuotaSnapshot,
  extractCodexQuotaSnapshot,
  type ClaudeQuotaSnapshot,
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
} from './types.js';
import {
  CLAUDE_STATUSLINE_SETUP_MESSAGE,
  CURRENT_BRIDGE_VERSION,
  DEFAULT_MENUBAR_POLL_INTERVAL_SECONDS,
  MENUBAR_SCHEMA_VERSION,
} from './types.js';
import { toRemainingPercent } from './format.js';
import { buildClaudeStatuslineBridge, buildOriginalClaudeStatuslineCommandScript } from './launchd.js';

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
  value: QuotaWindowSnapshot | null,
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
  snapshot: ClaudeQuotaSnapshot | null,
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
    claudeBridgeVersion: typeof raw.claudeBridgeVersion === 'number' ? raw.claudeBridgeVersion : 0,
  };
}

export function createDefaultMenubarConfig(): MenubarConfig {
  return {
    schemaVersion: MENUBAR_SCHEMA_VERSION,
    pollIntervalSeconds: DEFAULT_MENUBAR_POLL_INTERVAL_SECONDS,
    claudeStatusLineManaged: false,
    claudeStatusLineBackup: null,
    claudeBridgeVersion: 0,
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

// Keep for backward compatibility with tests that write bridge snapshots directly
export function writeClaudeBridgeSnapshot(
  paths: MenubarPaths,
  snapshot: ClaudeBridgeSnapshot,
): void {
  writeJsonAtomic(paths.claudeSnapshotPath, snapshot);
}

export function writeSnapshot(paths: MenubarPaths, snapshot: MenubarSnapshot): void {
  writeJsonAtomic(paths.snapshotPath, snapshot);
}

// ---------------------------------------------------------------------------
// Self-healing: detect when ~/.claude/settings.json statusLine was overwritten
// and auto-repair it to point back to the tokenleak bridge script.
// ---------------------------------------------------------------------------

interface CommandStatusLine {
  type: 'command';
  command: string;
}

function readClaudeSettings(paths: MenubarPaths): Record<string, unknown> {
  if (!existsSync(paths.claudeSettingsPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(paths.claudeSettingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeClaudeSettings(paths: MenubarPaths, settings: Record<string, unknown>): void {
  ensureMenubarDir(dirname(paths.claudeSettingsPath));
  writeFileSync(paths.claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function parseCommandStatusLine(setting: unknown): CommandStatusLine | null {
  if (typeof setting !== 'object' || setting === null) {
    return null;
  }

  const record = setting as Record<string, unknown>;
  if (record['type'] !== 'command' || typeof record['command'] !== 'string') {
    return null;
  }

  return { type: 'command', command: record['command'] };
}

function isManagedStatusLine(paths: MenubarPaths, value: unknown): boolean {
  const parsed = parseCommandStatusLine(value);
  return parsed?.command === paths.claudeStatuslineWrapperPath;
}

function managedStatusLineSetting(paths: MenubarPaths): CommandStatusLine {
  return { type: 'command', command: paths.claudeStatuslineWrapperPath };
}

export function ensureClaudeStatusLineConfig(
  paths: MenubarPaths,
  config: MenubarConfig,
): MenubarConfig {
  if (!config.claudeStatusLineManaged) {
    return config;
  }

  const settings = readClaudeSettings(paths);
  const needsSettingsRepair = !isManagedStatusLine(paths, settings['statusLine']);
  const needsBridgeUpgrade = config.claudeBridgeVersion < CURRENT_BRIDGE_VERSION;

  if (!needsSettingsRepair && !needsBridgeUpgrade) {
    return config;
  }

  // If settings were overwritten, capture the new command as the "original"
  if (needsSettingsRepair) {
    const current = parseCommandStatusLine(settings['statusLine']);
    if (current) {
      config.claudeStatusLineBackup = settings['statusLine'];
      writeExecutableScript(
        paths.previousClaudeStatuslineCommandPath,
        buildOriginalClaudeStatuslineCommandScript(current.command),
      );
    }

    settings['statusLine'] = managedStatusLineSetting(paths);
    writeClaudeSettings(paths, settings);
  }

  // Regenerate the bridge script (handles both repair and upgrade)
  writeExecutableScript(paths.claudeStatuslineWrapperPath, buildClaudeStatuslineBridge(paths));
  config.claudeBridgeVersion = CURRENT_BRIDGE_VERSION;
  writeMenubarConfig(paths, config);

  return config;
}

// Re-export for install.ts
export { isManagedStatusLine as isManagedClaudeStatusLineSetting };

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

  let claudeSnapshot: ClaudeQuotaSnapshot | null = null;
  let claudeError: string | null = null;
  try {
    claudeSnapshot = extractClaudeQuotaSnapshot(paths.claudeSnapshotPath);
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
