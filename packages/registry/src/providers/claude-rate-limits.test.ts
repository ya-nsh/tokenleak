import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractClaudeQuotaSnapshot } from './claude-rate-limits';

describe('extractClaudeQuotaSnapshot', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeSnapshot(dir: string, data: Record<string, unknown>): string {
    const path = join(dir, 'claude-rate-limits.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    return path;
  }

  it('returns a valid snapshot with both windows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const path = writeSnapshot(dir, {
      schemaVersion: 1,
      source: 'claude-statusline',
      capturedAt: '2026-03-28T10:00:00.000Z',
      planType: 'max',
      fiveHour: { usedPercent: 23, windowMinutes: 300, resetAt: '2026-03-28T15:00:00.000Z' },
      sevenDay: { usedPercent: 41, windowMinutes: 10080, resetAt: '2026-04-04T10:00:00.000Z' },
    });

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.provider).toBe('claude-code');
    expect(snapshot?.capturedAt).toBe('2026-03-28T10:00:00.000Z');
    expect(snapshot?.planType).toBe('max');
    expect(snapshot?.fiveHour?.usedPercent).toBe(23);
    expect(snapshot?.fiveHour?.windowMinutes).toBe(300);
    expect(snapshot?.sevenDay?.usedPercent).toBe(41);
    expect(snapshot?.sevenDay?.windowMinutes).toBe(10080);
  });

  it('returns null when the file does not exist', () => {
    const snapshot = extractClaudeQuotaSnapshot('/tmp/nonexistent-claude-rl.json');
    expect(snapshot).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const path = join(dir, 'claude-rate-limits.json');
    writeFileSync(path, 'not json at all');

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot).toBeNull();
  });

  it('returns null when both windows are missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const path = writeSnapshot(dir, {
      schemaVersion: 1,
      capturedAt: '2026-03-28T10:00:00.000Z',
      fiveHour: null,
      sevenDay: null,
    });

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot).toBeNull();
  });

  it('returns snapshot with only fiveHour present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const path = writeSnapshot(dir, {
      schemaVersion: 1,
      capturedAt: '2026-03-28T10:00:00.000Z',
      planType: 'pro',
      fiveHour: { usedPercent: 55, windowMinutes: 300, resetAt: '2026-03-28T15:00:00.000Z' },
      sevenDay: null,
    });

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.fiveHour?.usedPercent).toBe(55);
    expect(snapshot?.sevenDay).toBeNull();
  });

  it('converts epoch resetAt to ISO string', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const epochSeconds = 1774900800;
    const path = writeSnapshot(dir, {
      schemaVersion: 1,
      capturedAt: '2026-03-28T10:00:00.000Z',
      fiveHour: { usedPercent: 10, windowMinutes: 300, resetAt: epochSeconds },
      sevenDay: null,
    });

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.fiveHour?.resetAt).toBe(new Date(epochSeconds * 1000).toISOString());
  });

  it('preserves ISO string resetAt as-is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const path = writeSnapshot(dir, {
      schemaVersion: 1,
      capturedAt: '2026-03-28T10:00:00.000Z',
      fiveHour: { usedPercent: 10, windowMinutes: 300, resetAt: '2026-03-28T15:00:00.000Z' },
      sevenDay: null,
    });

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot?.fiveHour?.resetAt).toBe('2026-03-28T15:00:00.000Z');
  });

  it('returns null for unsupported schema version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const path = writeSnapshot(dir, {
      schemaVersion: 999,
      capturedAt: '2026-03-28T10:00:00.000Z',
      fiveHour: { usedPercent: 10, windowMinutes: 300, resetAt: null },
      sevenDay: null,
    });

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot).toBeNull();
  });

  it('handles snake_case field names from the bridge script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-claude-rl-'));
    tempDirs.push(dir);

    const path = writeSnapshot(dir, {
      schemaVersion: 1,
      capturedAt: '2026-03-28T10:00:00.000Z',
      fiveHour: { used_percentage: 30, window_minutes: 300, resets_at: 1774900800 },
      sevenDay: { used_percent: 50, window_minutes: 10080, reset_at: '2026-04-04T10:00:00.000Z' },
    });

    const snapshot = extractClaudeQuotaSnapshot(path);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.fiveHour?.usedPercent).toBe(30);
    expect(snapshot?.sevenDay?.usedPercent).toBe(50);
  });
});
