import type { ReportKind, ReportRequest, ReportResults } from './engine-core.js';

export interface ReportTaskContext {
  report<K extends ReportKind>(request: ReportRequest<K>): Promise<ReportResults[K] | null>;
  /** Identity of the loaded data; a different value means it was reloaded. */
  currentData(): unknown;
  /** The selected view's task key now (window, range, day, page). */
  currentKey(): string;
}

/**
 * A view task that fetches one report and hands it to `assign`. Reports arrive
 * asynchronously, so a result is dropped if the data was reloaded or the view
 * task key changed while it was computing; the view then asks again for what
 * is selected now. A missing report is an error, so the view shows it instead
 * of asking forever.
 */
export function createReportTask<K extends ReportKind>(
  context: ReportTaskContext,
  key: string,
  request: ReportRequest<K>,
  assign: (report: ReportResults[K]) => void,
): () => Promise<void> {
  return async () => {
    const data = context.currentData();
    const report = await context.report(request);
    if (context.currentData() !== data || context.currentKey() !== key) return;
    if (report === null) throw new Error('no data for this window');
    assign(report);
  };
}
