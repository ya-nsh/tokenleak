import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMenubarPaths } from './paths';
import {
  createDefaultMenubarConfig,
  ensureClaudeStatusLineConfig,
  refreshMenubarSnapshot,
  writeClaudeBridgeSnapshot,
  writeMenubarConfig,
} from './state';
import { CURRENT_BRIDGE_VERSION } from './types';

function writeSession(root: string, relativePath: string, line: Record<string, unknown>): void {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(line)}\n`);
}

function writeClaudeSettings(paths: ReturnType<typeof resolveMenubarPaths>, settings: Record<string, unknown>): void {
  mkdirSync(dirname(paths.claudeSettingsPath), { recursive: true });
  writeFileSync(paths.claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function readClaudeSettings(paths: ReturnType<typeof resolveMenubarPaths>): Record<string, unknown> {
  return JSON.parse(readFileSync(paths.claudeSettingsPath, 'utf8')) as Record<string, unknown>;
}

describe('refreshMenubarSnapshot', () => {
  const tempDirs: string[] = [];
  const originalCodexHome = process.env['CODEX_HOME'];

  afterEach(() => {
    if (originalCodexHome === undefined) {
      delete process.env['CODEX_HOME'];
    } else {
      process.env['CODEX_HOME'] = originalCodexHome;
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a compact dual-provider title from Codex and Claude snapshots', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'tokenleak-menubar-home-'));
    const codexHome = mkdtempSync(join(tmpdir(), 'tokenleak-codex-home-'));
    tempDirs.push(homeDir, codexHome);
    process.env['CODEX_HOME'] = codexHome;

    writeSession(codexHome, 'sessions/2026/03/28/session.jsonl', {
      timestamp: '2026-03-28T09:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          primary: { used_percent: 17, window_minutes: 300, resets_at: 4102444800 },
          secondary: { used_percent: 43, window_minutes: 10080, resets_at: 4103049600 },
          plan_type: 'plus',
        },
      },
    });

    const paths = resolveMenubarPaths(homeDir);
    const config = createDefaultMenubarConfig();
    config.claudeStatusLineManaged = true;
    writeMenubarConfig(paths, config);
    writeClaudeBridgeSnapshot(paths, {
      schemaVersion: 1,
      source: 'claude-statusline',
      capturedAt: '2026-03-28T09:02:00.000Z',
      planType: 'max',
      fiveHour: { usedPercent: 62, windowMinutes: 300, resetAt: '2099-12-31T12:00:00.000Z' },
      sevenDay: { usedPercent: 54, windowMinutes: 10080, resetAt: '2099-12-31T12:00:00.000Z' },
    });

    const snapshot = await refreshMenubarSnapshot(paths);

    expect(snapshot.title).toBe('Cdx 83% | Cld 38%');
    expect(snapshot.providers.codex.state).toBe('ready');
    expect(snapshot.providers.codex.planType).toBe('plus');
    expect(snapshot.providers.claudeCode.state).toBe('ready');
    expect(snapshot.providers.claudeCode.planType).toBe('max');
  });

  it('marks Claude as waiting when the statusline bridge is configured but has no snapshot yet', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'tokenleak-menubar-home-'));
    tempDirs.push(homeDir);

    const paths = resolveMenubarPaths(homeDir);
    const config = createDefaultMenubarConfig();
    config.claudeStatusLineManaged = true;
    writeMenubarConfig(paths, config);

    const snapshot = await refreshMenubarSnapshot(paths);

    expect(snapshot.providers.claudeCode.state).toBe('waiting_for_first_snapshot');
    expect(snapshot.providers.claudeCode.message).toContain('trusted interactive workspace');
    expect(snapshot.title).toContain('Cld --');
  });
});

describe('ensureClaudeStatusLineConfig', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('repairs settings.json when statusLine was overwritten', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'tokenleak-menubar-heal-'));
    tempDirs.push(homeDir);

    const paths = resolveMenubarPaths(homeDir);
    const config = createDefaultMenubarConfig();
    config.claudeStatusLineManaged = true;
    config.claudeBridgeVersion = CURRENT_BRIDGE_VERSION;
    writeMenubarConfig(paths, config);

    // Simulate user/Claude overwriting the statusLine
    writeClaudeSettings(paths, {
      statusLine: { type: 'command', command: 'sh ~/.claude/my-custom-statusline.sh' },
    });

    const updated = ensureClaudeStatusLineConfig(paths, config);

    // Settings should be repaired
    const settings = readClaudeSettings(paths);
    const statusLine = settings['statusLine'] as Record<string, unknown>;
    expect(statusLine['command']).toBe(paths.claudeStatuslineWrapperPath);

    // Backup should capture the overwritten command
    const backup = updated.claudeStatusLineBackup as Record<string, unknown>;
    expect(backup['command']).toBe('sh ~/.claude/my-custom-statusline.sh');

    // Original command script should exist
    expect(existsSync(paths.previousClaudeStatuslineCommandPath)).toBe(true);
  });

  it('does nothing when settings.json already points to our bridge', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'tokenleak-menubar-heal-'));
    tempDirs.push(homeDir);

    const paths = resolveMenubarPaths(homeDir);
    const config = createDefaultMenubarConfig();
    config.claudeStatusLineManaged = true;
    config.claudeBridgeVersion = CURRENT_BRIDGE_VERSION;
    writeMenubarConfig(paths, config);

    writeClaudeSettings(paths, {
      statusLine: { type: 'command', command: paths.claudeStatuslineWrapperPath },
    });

    const updated = ensureClaudeStatusLineConfig(paths, config);

    // No change — backup should remain null
    expect(updated.claudeStatusLineBackup).toBeNull();
  });

  it('skips repair when claudeStatusLineManaged is false', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'tokenleak-menubar-heal-'));
    tempDirs.push(homeDir);

    const paths = resolveMenubarPaths(homeDir);
    const config = createDefaultMenubarConfig();
    config.claudeStatusLineManaged = false;
    writeMenubarConfig(paths, config);

    writeClaudeSettings(paths, {
      statusLine: { type: 'command', command: 'something-else' },
    });

    const updated = ensureClaudeStatusLineConfig(paths, config);

    // Settings should NOT be modified
    const settings = readClaudeSettings(paths);
    const statusLine = settings['statusLine'] as Record<string, unknown>;
    expect(statusLine['command']).toBe('something-else');
    expect(updated.claudeStatusLineManaged).toBe(false);
  });

  it('upgrades bridge script when claudeBridgeVersion is outdated', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'tokenleak-menubar-heal-'));
    tempDirs.push(homeDir);

    const paths = resolveMenubarPaths(homeDir);
    const config = createDefaultMenubarConfig();
    config.claudeStatusLineManaged = true;
    config.claudeBridgeVersion = 0; // Old version
    writeMenubarConfig(paths, config);

    // Settings already point to our wrapper — but bridge version is old
    writeClaudeSettings(paths, {
      statusLine: { type: 'command', command: paths.claudeStatuslineWrapperPath },
    });

    const updated = ensureClaudeStatusLineConfig(paths, config);

    expect(updated.claudeBridgeVersion).toBe(CURRENT_BRIDGE_VERSION);
    // Bridge script should have been regenerated
    expect(existsSync(paths.claudeStatuslineWrapperPath)).toBe(true);
    const bridgeContent = readFileSync(paths.claudeStatuslineWrapperPath, 'utf8');
    expect(bridgeContent).toContain('/usr/bin/python3');
  });
});
