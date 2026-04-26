import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MenubarPaths } from './types.js';

export const MENUBAR_APP_LABEL = 'com.tokenleak.menubar';

export function resolveMenubarPaths(homeDir: string = homedir()): MenubarPaths {
  const appSupportDir = join(homeDir, 'Library', 'Application Support', 'tokenleak', 'menubar');
  const logsDir = join(appSupportDir, 'logs');
  const launchAgentsDir = join(homeDir, 'Library', 'LaunchAgents');

  return {
    homeDir,
    appSupportDir,
    logsDir,
    launchAgentsDir,
    configPath: join(appSupportDir, 'config.json'),
    snapshotPath: join(appSupportDir, 'snapshot.json'),
    claudeSnapshotPath: join(appSupportDir, 'claude-rate-limits.json'),
    cliWrapperPath: join(appSupportDir, 'tokenleak-menubar-cli'),
    dashboardWrapperPath: join(appSupportDir, 'tokenleak-menubar-dashboard'),
    claudeStatuslineWrapperPath: join(appSupportDir, 'tokenleak-menubar-claude-statusline'),
    previousClaudeStatuslineCommandPath: join(appSupportDir, 'claude-statusline-original'),
    installedAppPath: join(homeDir, 'Applications', 'Tokenleak Usage.app'),
    appPlistPath: join(launchAgentsDir, `${MENUBAR_APP_LABEL}.plist`),
    appLogPath: join(logsDir, 'app.log'),
    daemonLogPath: join(logsDir, 'daemon.log'),
    claudeSettingsPath: join(homeDir, '.claude', 'settings.json'),
  };
}
