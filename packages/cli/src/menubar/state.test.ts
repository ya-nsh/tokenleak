import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMenubarPaths } from './paths';
import {
  createDefaultMenubarConfig,
  refreshMenubarSnapshot,
  writeClaudeBridgeSnapshot,
  writeMenubarConfig,
} from './state';

function writeSession(root: string, relativePath: string, line: Record<string, unknown>): void {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(line)}\n`);
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
