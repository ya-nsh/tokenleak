import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractCodexQuotaSnapshot } from './codex-rate-limits';

function writeSession(root: string, relativePath: string, lines: string[]): void {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${lines.join('\n')}\n`);
}

describe('extractCodexQuotaSnapshot', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the newest non-null rate limits snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenleak-codex-quotas-'));
    tempDirs.push(root);

    writeSession(root, '2026/03/21/session-a.jsonl', [
      JSON.stringify({
        timestamp: '2026-03-21T09:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 12, window_minutes: 300, resets_at: 1774184683 },
            secondary: { used_percent: 44, window_minutes: 10080, resets_at: 1774554212 },
            plan_type: 'plus',
          },
        },
      }),
    ]);

    writeSession(root, '2026/03/22/session-b.jsonl', [
      JSON.stringify({
        timestamp: '2026-03-22T09:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: null,
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-22T10:15:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 18, window_minutes: 300, resets_at: 1774271083 },
            secondary: { used_percent: 51, window_minutes: 10080, resets_at: 1774637012 },
            plan_type: 'pro',
          },
        },
      }),
    ]);

    const snapshot = await extractCodexQuotaSnapshot(root);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.capturedAt).toBe('2026-03-22T10:15:00.000Z');
    expect(snapshot?.planType).toBe('pro');
    expect(snapshot?.fiveHour?.usedPercent).toBe(18);
    expect(snapshot?.fiveHour?.windowMinutes).toBe(300);
    expect(snapshot?.sevenDay?.usedPercent).toBe(51);
    expect(snapshot?.sevenDay?.windowMinutes).toBe(10080);
  });

  it('returns null when no usable rate limits exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenleak-codex-quotas-'));
    tempDirs.push(root);

    writeSession(root, '2026/03/22/session.jsonl', [
      JSON.stringify({
        timestamp: '2026-03-22T10:15:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: null,
        },
      }),
    ]);

    const snapshot = await extractCodexQuotaSnapshot(root);
    expect(snapshot).toBeNull();
  });
});
