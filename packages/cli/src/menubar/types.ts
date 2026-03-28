export const MENUBAR_SCHEMA_VERSION = 1;
export const DEFAULT_MENUBAR_POLL_INTERVAL_SECONDS = 30;
export const CLAUDE_STATUSLINE_SETUP_MESSAGE =
  'Claude live quota data has not arrived yet. Use Claude Code in a trusted interactive workspace and get one response.';

export type MenubarProviderState =
  | 'ready'
  | 'setup_required'
  | 'waiting_for_first_snapshot'
  | 'stale'
  | 'error';

export interface StoredQuotaWindow {
  usedPercent: number;
  windowMinutes: number;
  resetAt: string | null;
}

export interface ClaudeBridgeSnapshot {
  schemaVersion: number;
  source: 'claude-statusline';
  capturedAt: string;
  planType: string | null;
  fiveHour: StoredQuotaWindow | null;
  sevenDay: StoredQuotaWindow | null;
}

export interface MenubarWindowSnapshot {
  label: string;
  usedPercent: number | null;
  resetAt: string | null;
  windowMinutes: number;
  isStale: boolean;
}

export interface MenubarProviderSnapshot {
  label: string;
  shortLabel: string;
  source: string;
  state: MenubarProviderState;
  planType: string | null;
  lastUpdatedAt: string | null;
  message: string | null;
  windows: {
    fiveHour: MenubarWindowSnapshot;
    sevenDay: MenubarWindowSnapshot;
  };
}

export interface MenubarSnapshot {
  schemaVersion: number;
  generatedAt: string;
  title: string;
  providers: {
    codex: MenubarProviderSnapshot;
    claudeCode: MenubarProviderSnapshot;
  };
}

export interface MenubarConfig {
  schemaVersion: number;
  pollIntervalSeconds: number;
  claudeStatusLineManaged: boolean;
  claudeStatusLineBackup: unknown | null;
}

export interface MenubarPaths {
  homeDir: string;
  appSupportDir: string;
  logsDir: string;
  launchAgentsDir: string;
  configPath: string;
  snapshotPath: string;
  claudeSnapshotPath: string;
  cliWrapperPath: string;
  dashboardWrapperPath: string;
  claudeStatuslineWrapperPath: string;
  previousClaudeStatuslineCommandPath: string;
  installedAppPath: string;
  appPlistPath: string;
  appLogPath: string;
  daemonLogPath: string;
  claudeSettingsPath: string;
}
