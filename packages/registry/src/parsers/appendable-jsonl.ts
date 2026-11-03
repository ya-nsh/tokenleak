import { getMaxRecordBytes, parseJsonlLine, scanJsonlLines } from './jsonl-splitter';
import type { JsonlRecordWarning } from './jsonl-splitter';
import type { AppendableParse, ResumePoint } from './usage-cache';

export interface AppendableJsonlVisitor<T, S> {
  initialState(): S;
  cloneState(state: S): S;
  /** Folds one parsed record into `state`, pushing any usage it yields onto `records`. */
  visit(record: unknown, state: S, records: T[]): void;
}

/**
 * Parses a JSONL file from `from` (or the start) for
 * {@link UsageFileCache.readAppendable}. The resume point and state are taken
 * after the last newline-terminated line; records and warnings from an
 * unterminated final line are still returned but counted as the tail, so a
 * later resume reads that line again once it is complete.
 */
export async function parseAppendableJsonl<T, S>(
  file: string,
  from: ResumePoint<S> | null,
  visitor: AppendableJsonlVisitor<T, S>,
): Promise<AppendableParse<T, S>> {
  const maxBytes = getMaxRecordBytes();
  const records: T[] = [];
  const warnings: JsonlRecordWarning[] = [];
  const state = from ? from.state : visitor.initialState();
  let offset = from?.offset ?? 0;
  let lineNumber = from?.lineNumber ?? 0;
  let committed: { state: S; records: number; warnings: number } | null = null;

  for await (const line of scanJsonlLines(file, { start: offset, lineNumber })) {
    if (!line.terminated && committed === null) {
      committed = { state: visitor.cloneState(state), records: records.length, warnings: warnings.length };
    }
    const parsed = parseJsonlLine(line, file, maxBytes, (warning) => warnings.push(warning));
    if (parsed) visitor.visit(parsed.value, state, records);
    if (line.terminated) {
      offset = line.end;
      lineNumber = line.line;
    }
  }

  return {
    records,
    warnings,
    offset,
    lineNumber,
    state: committed ? committed.state : state,
    tailRecords: committed ? records.length - committed.records : 0,
    tailWarnings: committed ? warnings.length - committed.warnings : 0,
  };
}
