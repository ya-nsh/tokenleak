import { expect, test } from 'bun:test';
import { formatQuotaReset, formatQuotaWindow, quotaLines, quotaSummary } from './quota';
const now = Date.parse('2026-09-06T12:00:00Z');
test('reset countdown covers unknown, elapsed, minutes, hours and days', () => {
  expect(formatQuotaReset(null, now)).toBe('Reset time unavailable');
  expect(formatQuotaReset('bad', now)).toBe('Reset time unavailable');
  expect(formatQuotaReset('2026-09-01', now)).toContain('refresh to confirm');
  expect(formatQuotaReset('2026-09-06T12:05:00Z', now)).toContain('5m');
  expect(formatQuotaReset('2026-09-06T15:00:00Z', now)).toContain('3h 0m');
  expect(formatQuotaReset('2026-09-08T15:00:00Z', now)).toContain('2d 3h');
});
test('unknown is different from unlimited and exhausted', () => {
  const bucket = {
    id: 'x',
    label: 'Session',
    usedPercent: null,
    remainingPercent: null,
    resetsAt: null,
    unlimited: false,
  };
  expect(formatQuotaWindow(bucket, now)).toContain('Capacity unavailable');
  expect(formatQuotaWindow({ ...bucket, unlimited: true }, now)).toContain('Unlimited');
  expect(
    formatQuotaWindow({ ...bucket, remainingPercent: 0, resetsAt: '2026-09-01' }, now),
  ).toContain('[----------] 0% left (last reported)');
});
test('stale readings and retry guidance are visible', () => {
  const lines = quotaLines(
    {
      schemaVersion: 1,
      checkedAt: new Date(now).toISOString(),
      providers: [
        {
          provider: 'claude',
          status: 'rate-limited',
          plan: null,
          windows: [],
          stale: true,
          fetchedAt: new Date(now - 60000).toISOString(),
          retryAt: new Date(now + 60000).toISOString(),
          message: 'Wait before refreshing.',
        },
      ],
    },
    now,
  ).join('\n');
  expect(lines).toContain('STALE');
  expect(lines).toContain('Last successful');
  expect(lines).toContain('Retry after');
});
test('quota summary shows each ready provider’s tightest window', () => {
  const bucket = (remainingPercent: number | null, unlimited = false) => ({
    id: String(remainingPercent),
    label: 'Window',
    usedPercent: null,
    remainingPercent,
    resetsAt: null,
    unlimited,
  });
  const provider = (
    name: 'claude' | 'codex' | 'copilot',
    windows: ReturnType<typeof bucket>[],
    status: 'ready' | 'auth-required' = 'ready',
    stale = false,
  ) => ({
    provider: name,
    status,
    plan: null,
    windows,
    fetchedAt: null,
    stale,
    message: null,
    retryAt: null,
  });
  const summary = quotaSummary({
    schemaVersion: 1,
    checkedAt: '2026-09-06T12:00:00Z',
    providers: [
      provider('claude', [bucket(80), bucket(41.6), bucket(null)]),
      provider('codex', [bucket(null, true), bucket(90)], 'ready', true),
      provider('copilot', [bucket(10)], 'auth-required'),
    ],
  });
  expect(summary).toBe('Claude 42% · Codex 90% (stale)');
});
test('quota summary is null when nothing reported a limited window', () => {
  expect(
    quotaSummary({ schemaVersion: 1, checkedAt: '2026-09-06T12:00:00Z', providers: [] }),
  ).toBeNull();
});
