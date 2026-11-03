import { describe, expect, test } from 'bun:test';
import type { FocusReport } from '@tokenleak/core';
import type { ReportKind, ReportRequest, ReportResults } from './engine-core';
import { createReportTask } from './report-task';
import type { ReportTaskContext } from './report-task';

const REPORT: FocusReport = { method: 'test', entries: [] };

function context(
  overrides: Partial<ReportTaskContext> & { during?: () => void } = {},
): ReportTaskContext & { requests: ReportRequest[] } {
  const requests: ReportRequest[] = [];
  return {
    requests,
    currentData: () => 'data-1',
    currentKey: () => 'focus:4',
    async report<K extends ReportKind>(request: ReportRequest<K>): Promise<ReportResults[K] | null> {
      requests.push(request);
      overrides.during?.();
      return REPORT as ReportResults[K];
    },
    ...overrides,
  };
}

describe('createReportTask', () => {
  test('assigns the report when nothing changed while it computed', async () => {
    const assigned: FocusReport[] = [];
    const ctx = context();
    await createReportTask(ctx, 'focus:4', { kind: 'focus', window: 4 }, (report) => {
      assigned.push(report);
    })();
    expect(assigned).toEqual([REPORT]);
    expect(ctx.requests).toEqual([{ kind: 'focus', window: 4 }]);
  });

  test('drops a report when the window changed while it computed', async () => {
    let key = 'focus:4';
    let assigned = false;
    const ctx = context({ currentKey: () => key, during: () => (key = 'focus:1') });
    await createReportTask(ctx, 'focus:4', { kind: 'focus', window: 4 }, () => {
      assigned = true;
    })();
    expect(assigned).toBe(false);
  });

  test('drops a report when the data was reloaded while it computed', async () => {
    let data = 'data-1';
    let assigned = false;
    const ctx = context({ currentData: () => data, during: () => (data = 'data-2') });
    await createReportTask(ctx, 'focus:4', { kind: 'focus', window: 4 }, () => {
      assigned = true;
    })();
    expect(assigned).toBe(false);
  });

  test('reports a missing result as an error instead of retrying forever', async () => {
    const ctx = context({ report: async () => null });
    await expect(createReportTask(ctx, 'focus:4', { kind: 'focus', window: 4 }, () => {})()).rejects.toThrow(
      'no data for this window',
    );
  });

  test('passes engine failures through to the view', async () => {
    const ctx = context({
      report: async () => {
        throw new Error('Data engine stopped');
      },
    });
    await expect(createReportTask(ctx, 'focus:4', { kind: 'focus', window: 4 }, () => {})()).rejects.toThrow(
      'Data engine stopped',
    );
  });
});
