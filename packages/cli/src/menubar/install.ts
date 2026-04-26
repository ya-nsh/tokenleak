import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { TokenleakError } from '../errors.js';
import { formatPercentLeft, formatTimestamp } from './format.js';
import {
  buildAppPlist,
  buildCliWrapper,
  buildClaudeStatuslineBridge,
  buildDashboardWrapper,
  buildOriginalClaudeStatuslineCommandScript,
} from './launchd.js';
import { MENUBAR_APP_LABEL, resolveMenubarPaths } from './paths.js';
import {
  clearMenubarState,
  createDefaultMenubarConfig,
  ensureMenubarDir,
  isManagedClaudeStatusLineSetting,
  readMenubarConfig,
  readSnapshot,
  writeExecutableScript,
  writeMenubarConfig,
} from './state.js';
import { CURRENT_BRIDGE_VERSION } from './types.js';
import type { MenubarConfig, MenubarPaths } from './types.js';

const LEGACY_APP_LABEL = 'com.tokenleak.menubar.app';
const LEGACY_SERVICE_LABEL = 'com.tokenleak.menubar.service';
const LEGACY_APP_NAME = 'Tokenleak Menu.app';
const LEGACY_SERVICE_WRAPPER = 'tokenleak-menubar-service';

function runCommand(command: string[], cwd?: string, quiet: boolean = false): void {
  const proc = Bun.spawnSync(command, {
    cwd,
    stdout: quiet ? 'ignore' : 'inherit',
    stderr: quiet ? 'ignore' : 'inherit',
  });

  if (proc.exitCode !== 0) {
    throw new TokenleakError(`Command failed: ${command.join(' ')}`);
  }
}

function resolveLocalMenubarBuilderPath(): string {
  return resolve(import.meta.dir, '../../../../scripts/build-menubar-app.ts');
}

function resolveLocalBuiltAppPath(): string {
  return resolve(import.meta.dir, '../../../../packages/menubar/dist', 'Tokenleak Usage.app');
}

function ensureInstallDirs(paths: MenubarPaths): void {
  ensureMenubarDir(paths.appSupportDir);
  ensureMenubarDir(paths.logsDir);
  ensureMenubarDir(paths.launchAgentsDir);
  ensureMenubarDir(dirname(paths.installedAppPath));
  ensureMenubarDir(dirname(paths.claudeSettingsPath));
}

function buildLocalApp(): string {
  const buildScript = resolveLocalMenubarBuilderPath();
  if (!existsSync(buildScript)) {
    throw new TokenleakError('Local menubar app builder not found.');
  }

  runCommand([process.execPath, buildScript], resolve(import.meta.dir, '../../../../'));
  const appPath = resolveLocalBuiltAppPath();
  if (!existsSync(appPath)) {
    throw new TokenleakError('Menubar app build did not produce an app bundle.');
  }
  return appPath;
}

function copyAppBundle(sourceAppPath: string, targetAppPath: string): void {
  rmSync(targetAppPath, { recursive: true, force: true });
  cpSync(sourceAppPath, targetAppPath, { recursive: true });
}

function readClaudeSettings(paths: MenubarPaths): Record<string, unknown> {
  if (!existsSync(paths.claudeSettingsPath)) {
    return {};
  }

  return JSON.parse(readFileSync(paths.claudeSettingsPath, 'utf8')) as Record<string, unknown>;
}

function writeClaudeSettings(paths: MenubarPaths, settings: Record<string, unknown>): void {
  ensureMenubarDir(dirname(paths.claudeSettingsPath));
  writeFileSync(paths.claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function parseCommandStatusLine(setting: unknown): { type: 'command'; command: string } | null {
  if (typeof setting !== 'object' || setting === null) {
    return null;
  }

  const record = setting as Record<string, unknown>;
  if (record['type'] !== 'command' || typeof record['command'] !== 'string') {
    return null;
  }

  return { type: 'command', command: record['command'] };
}

function writeInstallArtifacts(
  paths: MenubarPaths,
  cliEntrypoint: string,
  config: MenubarConfig,
): void {
  writeExecutableScript(paths.cliWrapperPath, buildCliWrapper(process.execPath, cliEntrypoint));
  writeExecutableScript(paths.dashboardWrapperPath, buildDashboardWrapper(paths));
  writeExecutableScript(paths.claudeStatuslineWrapperPath, buildClaudeStatuslineBridge(paths));

  const previous = parseCommandStatusLine(config.claudeStatusLineBackup);
  if (previous) {
    writeExecutableScript(
      paths.previousClaudeStatuslineCommandPath,
      buildOriginalClaudeStatuslineCommandScript(previous.command),
    );
  } else {
    rmSync(paths.previousClaudeStatuslineCommandPath, { force: true });
  }

  writeFileSync(paths.appPlistPath, buildAppPlist(paths));
  writeMenubarConfig(paths, config);
}

function configureClaudeStatusLine(paths: MenubarPaths, config: MenubarConfig): MenubarConfig {
  const settings = readClaudeSettings(paths);
  const current = settings['statusLine'];

  if (!isManagedClaudeStatusLineSetting(paths, current)) {
    config.claudeStatusLineBackup = current ?? null;
  }

  settings['statusLine'] = { type: 'command', command: paths.claudeStatuslineWrapperPath };
  config.claudeStatusLineManaged = true;
  config.claudeBridgeVersion = CURRENT_BRIDGE_VERSION;
  writeClaudeSettings(paths, settings);
  return config;
}

function restoreClaudeStatusLine(paths: MenubarPaths, config: MenubarConfig): void {
  const settings = readClaudeSettings(paths);
  if (!isManagedClaudeStatusLineSetting(paths, settings['statusLine'])) {
    return;
  }

  if (config.claudeStatusLineBackup === null) {
    delete settings['statusLine'];
  } else {
    settings['statusLine'] = config.claudeStatusLineBackup;
  }

  writeClaudeSettings(paths, settings);
}

function guiDomain(): string {
  const uid =
    typeof process.getuid === 'function' ? process.getuid() : Number(process.env['UID'] ?? 0);
  return `gui/${uid}`;
}

function launchctlLabelPath(label: string): string {
  return `${guiDomain()}/${label}`;
}

function bootoutIfLoaded(label: string, plistPath: string): void {
  const proc = Bun.spawnSync(['/bin/launchctl', 'bootout', launchctlLabelPath(label), plistPath], {
    stdout: 'ignore',
    stderr: 'ignore',
  });

  if (proc.exitCode !== 0) {
    Bun.spawnSync(['/bin/launchctl', 'bootout', guiDomain(), plistPath], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
  }
}

function killMatchingProcesses(pattern: string): void {
  Bun.spawnSync(['/usr/bin/pkill', '-f', pattern], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

function cleanupLegacyMenubarInstall(paths: MenubarPaths): void {
  const legacyAppPlistPath = join(paths.launchAgentsDir, `${LEGACY_APP_LABEL}.plist`);
  const legacyServicePlistPath = join(paths.launchAgentsDir, `${LEGACY_SERVICE_LABEL}.plist`);
  const legacyAppPath = join(dirname(paths.installedAppPath), LEGACY_APP_NAME);
  const legacyServiceWrapperPath = join(paths.appSupportDir, LEGACY_SERVICE_WRAPPER);

  if (existsSync(legacyAppPlistPath)) {
    bootoutIfLoaded(LEGACY_APP_LABEL, legacyAppPlistPath);
    unlinkSync(legacyAppPlistPath);
  }

  if (existsSync(legacyServicePlistPath)) {
    bootoutIfLoaded(LEGACY_SERVICE_LABEL, legacyServicePlistPath);
    unlinkSync(legacyServicePlistPath);
  }

  killMatchingProcesses('/Tokenleak Menu.app/Contents/MacOS/Tokenleak Menu');
  killMatchingProcesses('tokenleak-menubar-service');

  rmSync(legacyAppPath, { recursive: true, force: true });
  rmSync(legacyServiceWrapperPath, { force: true });
}

export function startMenubarApp(paths: MenubarPaths): void {
  if (!existsSync(paths.appPlistPath)) {
    throw new TokenleakError('Menubar is not installed. Run `tokenleak menubar install` first.');
  }

  bootoutIfLoaded(MENUBAR_APP_LABEL, paths.appPlistPath);
  runCommand(['/bin/launchctl', 'bootstrap', guiDomain(), paths.appPlistPath], undefined, true);
  runCommand(
    ['/bin/launchctl', 'kickstart', '-k', launchctlLabelPath(MENUBAR_APP_LABEL)],
    undefined,
    true,
  );
}

export function stopMenubarApp(paths: MenubarPaths): void {
  if (existsSync(paths.appPlistPath)) {
    bootoutIfLoaded(MENUBAR_APP_LABEL, paths.appPlistPath);
  }
}

export function openMenubarApp(paths: MenubarPaths): void {
  if (!existsSync(paths.installedAppPath)) {
    throw new TokenleakError('Menubar is not installed. Run `tokenleak menubar install` first.');
  }

  runCommand(['/usr/bin/open', paths.installedAppPath], undefined, true);
}

export function openDashboardInTerminal(paths: MenubarPaths): void {
  if (!existsSync(paths.dashboardWrapperPath)) {
    throw new TokenleakError('Dashboard wrapper missing. Reinstall the menubar.');
  }

  runCommand(['/usr/bin/open', '-a', 'Terminal', paths.dashboardWrapperPath], undefined, true);
}

function launchctlState(label: string): 'loaded' | 'stopped' {
  const proc = Bun.spawnSync(['/bin/launchctl', 'print', launchctlLabelPath(label)], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return proc.exitCode === 0 ? 'loaded' : 'stopped';
}

function printStateLine(label: string, value: string): void {
  process.stdout.write(`${label}: ${value}\n`);
}

export function printMenubarStatus(paths: MenubarPaths): void {
  const config = existsSync(paths.configPath) ? readMenubarConfig(paths) : createDefaultMenubarConfig();
  const snapshot = readSnapshot(paths);
  const claudeSettings = readClaudeSettings(paths);

  printStateLine('installed_app', existsSync(paths.installedAppPath) ? 'yes' : 'no');
  printStateLine(
    'app_agent',
    existsSync(paths.appPlistPath) ? launchctlState(MENUBAR_APP_LABEL) : 'missing',
  );
  printStateLine(
    'claude_statusline',
    isManagedClaudeStatusLineSetting(paths, claudeSettings['statusLine']) ? 'managed' : 'other',
  );
  printStateLine('poll_interval_seconds', String(config.pollIntervalSeconds));

  if (!snapshot) {
    printStateLine('snapshot', 'missing');
    return;
  }

  printStateLine('snapshot', 'present');
  printStateLine('title', snapshot.title);
  printStateLine('generated_at', formatTimestamp(snapshot.generatedAt));
  printStateLine('codex_state', snapshot.providers.codex.state);
  printStateLine(
    'codex_5h_left',
    formatPercentLeft(snapshot.providers.codex.windows.fiveHour.usedPercent),
  );
  if (snapshot.providers.codex.message) {
    printStateLine('codex_message', snapshot.providers.codex.message);
  }
  printStateLine('claude_state', snapshot.providers.claudeCode.state);
  printStateLine(
    'claude_5h_left',
    formatPercentLeft(snapshot.providers.claudeCode.windows.fiveHour.usedPercent),
  );
  if (snapshot.providers.claudeCode.message) {
    printStateLine('claude_message', snapshot.providers.claudeCode.message);
  }
}

export async function installMenubar(
  homeDir: string | undefined,
  cliEntrypoint: string,
): Promise<MenubarPaths> {
  const paths = resolveMenubarPaths(homeDir);
  ensureInstallDirs(paths);
  cleanupLegacyMenubarInstall(paths);

  let config = existsSync(paths.configPath) ? readMenubarConfig(paths) : createDefaultMenubarConfig();
  config = configureClaudeStatusLine(paths, config);

  const appSource = buildLocalApp();
  copyAppBundle(appSource, paths.installedAppPath);
  writeInstallArtifacts(paths, cliEntrypoint, config);
  startMenubarApp(paths);
  return paths;
}

export function uninstallMenubar(homeDir: string | undefined): MenubarPaths {
  const paths = resolveMenubarPaths(homeDir);
  const config = existsSync(paths.configPath) ? readMenubarConfig(paths) : createDefaultMenubarConfig();

  stopMenubarApp(paths);
  cleanupLegacyMenubarInstall(paths);
  restoreClaudeStatusLine(paths, config);
  if (existsSync(paths.appPlistPath)) unlinkSync(paths.appPlistPath);
  rmSync(paths.installedAppPath, { recursive: true, force: true });
  clearMenubarState(paths);
  rmSync(paths.appSupportDir, { recursive: true, force: true });
  return paths;
}
