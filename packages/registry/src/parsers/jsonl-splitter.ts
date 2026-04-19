import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { MAX_JSONL_RECORD_BYTES } from '@tokenleak/core';

export interface JsonlRecordWarning {
  kind: 'parse' | 'oversize';
  file: string;
  line: number;
}

export interface SplitJsonlOptions {
  onWarning?: (warning: JsonlRecordWarning) => void;
}

/**
 * Returns the maximum allowed record size in bytes.
 * Checks `TOKENLEAK_MAX_JSONL_RECORD_BYTES` env var first, then falls back to
 * the constant exported from `@tokenleak/core`.
 */
function getMaxRecordBytes(): number {
  const envValue = process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'];
  if (envValue !== undefined && envValue !== '') {
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid TOKENLEAK_MAX_JSONL_RECORD_BYTES value: "${envValue}". Must be a positive number.`,
      );
    }
    return parsed;
  }
  return MAX_JSONL_RECORD_BYTES;
}

/**
 * Async generator that reads a JSONL file line-by-line and yields parsed JSON
 * objects. Blank lines are skipped. Oversized or malformed records cause an
 * error that includes the file path and 1-based line number.
 */
export async function* splitJsonlRecords(
  filePath: string,
  options: SplitJsonlOptions = {},
): AsyncGenerator<unknown> {
  const maxBytes = getMaxRecordBytes();
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;

      // Skip blank lines and lines that are only whitespace/null bytes
      if (line.trim() === '' || /^\x00+$/.test(line) || !/[^\x00]/.test(line)) {
        continue;
      }

      const byteLength = new TextEncoder().encode(line).byteLength;
      if (byteLength > maxBytes) {
        options.onWarning?.({ kind: 'oversize', file: filePath, line: lineNumber });
        continue;
      }

      try {
        yield JSON.parse(line) as unknown;
      } catch {
        options.onWarning?.({ kind: 'parse', file: filePath, line: lineNumber });
      }
    }
  } finally {
    lines.close();
    input.close();
  }
}
