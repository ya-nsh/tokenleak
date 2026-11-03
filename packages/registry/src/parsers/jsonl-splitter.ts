import { createReadStream } from 'node:fs';
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
export function getMaxRecordBytes(): number {
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

/** One line of a JSONL file, located by byte offsets. */
export interface JsonlLine {
  text: string;
  /** 1-based line number, counting blank lines. */
  line: number;
  /** Byte offset just past this line's terminator, or the end of the file for an unterminated last line. */
  end: number;
  /** False only for a final line with no newline yet, which a live writer may still be appending to. */
  terminated: boolean;
}

export interface ScanJsonlOptions {
  /** Byte offset to start reading from; must sit at the start of a line. */
  start?: number;
  /** Number of lines before `start`, so reported line numbers stay file-relative. */
  lineNumber?: number;
}

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
/** Transcript lines often exceed the 64 KiB stream default; larger reads mean fewer joins. */
const READ_CHUNK_BYTES = 1024 * 1024;

/**
 * Reads a file as lines with byte offsets, using the same line breaks as
 * `readline` with `crlfDelay: Infinity`: `\n`, `\r\n` and a lone `\r`.
 * Newline bytes never occur inside UTF-8 sequences, so splitting the raw
 * bytes before decoding is safe.
 */
export async function* scanJsonlLines(
  filePath: string,
  options: ScanJsonlOptions = {},
): AsyncGenerator<JsonlLine> {
  const start = options.start ?? 0;
  let lineNumber = options.lineNumber ?? 0;
  const input = createReadStream(filePath, { start, highWaterMark: READ_CHUNK_BYTES });
  let pending: Buffer[] = [];
  let pendingStart = start;
  let offset = start;

  function* emitSegment(segment: Buffer, end: number, terminated: boolean): Generator<JsonlLine> {
    let length = segment.length;
    if (terminated && length > 0 && segment[length - 1] === CARRIAGE_RETURN) length -= 1;
    let pieceStart = 0;
    let carriageReturn = segment.indexOf(CARRIAGE_RETURN);
    while (carriageReturn !== -1 && carriageReturn < length) {
      lineNumber += 1;
      yield { text: segment.toString('utf8', pieceStart, carriageReturn), line: lineNumber, end, terminated };
      pieceStart = carriageReturn + 1;
      carriageReturn = segment.indexOf(CARRIAGE_RETURN, pieceStart);
    }
    lineNumber += 1;
    yield { text: segment.toString('utf8', pieceStart, length), line: lineNumber, end, terminated };
  }

  try {
    for await (const chunk of input as AsyncIterable<Buffer>) {
      let segmentStart = 0;
      let newline = chunk.indexOf(NEWLINE);
      while (newline !== -1) {
        const piece = chunk.subarray(segmentStart, newline);
        const segment = pending.length > 0 ? Buffer.concat([...pending, piece]) : piece;
        pending = [];
        const end = offset + newline + 1;
        yield* emitSegment(segment, end, true);
        pendingStart = end;
        segmentStart = newline + 1;
        newline = chunk.indexOf(NEWLINE, segmentStart);
      }
      if (segmentStart < chunk.length) pending.push(chunk.subarray(segmentStart));
      offset += chunk.length;
    }
    if (pending.length > 0) {
      const segment = Buffer.concat(pending);
      if (segment.length > 0) yield* emitSegment(segment, pendingStart + segment.length, false);
    }
  } finally {
    input.destroy();
  }
}

/** Blank lines and lines of only NUL bytes carry no record. */
export function isBlankJsonlLine(line: string): boolean {
  return line.trim() === '' || !/[^\x00]/.test(line);
}

/**
 * Parses one JSONL line, reporting oversized or malformed records as
 * warnings. Returns `undefined` for lines that yield no record.
 */
export function parseJsonlLine(
  line: JsonlLine,
  filePath: string,
  maxBytes: number,
  onWarning?: (warning: JsonlRecordWarning) => void,
): { value: unknown } | undefined {
  if (isBlankJsonlLine(line.text)) return undefined;
  if (Buffer.byteLength(line.text, 'utf8') > maxBytes) {
    onWarning?.({ kind: 'oversize', file: filePath, line: line.line });
    return undefined;
  }
  try {
    return { value: JSON.parse(line.text) as unknown };
  } catch {
    onWarning?.({ kind: 'parse', file: filePath, line: line.line });
    return undefined;
  }
}

/**
 * Async generator that reads a JSONL file line-by-line and yields parsed JSON
 * objects. Blank lines are skipped. Oversized or malformed records are skipped
 * and surfaced through the optional warning callback.
 */
export async function* splitJsonlRecords(
  filePath: string,
  options: SplitJsonlOptions = {},
): AsyncGenerator<unknown> {
  const maxBytes = getMaxRecordBytes();
  for await (const line of scanJsonlLines(filePath)) {
    const parsed = parseJsonlLine(line, filePath, maxBytes, options.onWarning);
    if (parsed) yield parsed.value;
  }
}
