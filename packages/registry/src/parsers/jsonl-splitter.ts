import { MAX_JSONL_RECORD_BYTES } from '@tokenleak/core';

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
): AsyncGenerator<unknown> {
  const maxBytes = getMaxRecordBytes();

  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split('\n');

  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;

    if (line.trim() === '') {
      continue;
    }

    const byteLength = new TextEncoder().encode(line).byteLength;
    if (byteLength > maxBytes) {
      throw new Error(
        `Oversized JSONL record in ${filePath} at line ${lineNumber}: ${byteLength} bytes exceeds limit of ${maxBytes} bytes`,
      );
    }

    try {
      yield JSON.parse(line) as unknown;
    } catch {
      throw new Error(
        `Malformed JSON in ${filePath} at line ${lineNumber}: unable to parse`,
      );
    }
  }
}
