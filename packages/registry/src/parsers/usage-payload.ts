/**
 * Encoding of the per-file payload stored by {@link UsageFileCache}.
 *
 * Usage records of one file repeat the same keys, and often the same values
 * (session, project), on every record. The columnar layout stores each key
 * once, each value shared by all records once, and the rest as row arrays,
 * which makes Claude Code payloads roughly a third of their row-layout size.
 * Records the columnar layout cannot represent exactly are stored as rows.
 */

/**
 * Marks a columnar payload. Row payloads, written before this layout existed,
 * carry no format. The value is part of the cache key, so changing it moves
 * every cache to a new key; only the pre-columnar key is read through.
 */
export const COLUMNAR_PAYLOAD_FORMAT = 2;

/** A key that would replace an object's prototype when assigned; never encoded column-wise. */
const PROTOTYPE_KEY = '__proto__';

type Scalar = string | number | boolean;
type PlainRecord = Record<string, unknown>;

export interface DecodedPayload {
  /** Not yet validated against the caller's record schema. */
  records: unknown[];
  /** Not yet validated against the source file. */
  warnings: unknown[];
}

interface RowPayload {
  records: unknown[];
  warnings: unknown[];
  /** Prompt text keyed by promptId; see {@link packPrompts}. */
  prompts?: Record<string, string>;
}

interface ColumnarPayload {
  format: typeof COLUMNAR_PAYLOAD_FORMAT;
  warnings: unknown[];
  /** Every key that occurs in any record, in first-seen order. */
  keys: string[];
  /** Keys every record holds with this same value. */
  shared: Record<string, Scalar>;
  /** The remaining keys, in the order of each row's cells. */
  columns: string[];
  /** One array per record; `null` marks a key that record does not have. */
  rows: unknown[][];
  prompts?: Record<string, string>;
}

type PromptCarrier = { prompt?: unknown; promptId?: unknown };

/**
 * Move repeated prompt text into a per-file table. Every assistant message in
 * a turn carries the same prompt, so storing it once per file is far smaller.
 * A record whose prompt disagrees with the table keeps its own text.
 */
export function packPrompts<T>(records: T[]): { records: T[]; prompts?: Record<string, string> } {
  const prompts: Record<string, string> = {};
  let packed = false;
  const out = records.map((record) => {
    const carrier = record as PromptCarrier;
    if (typeof carrier.prompt !== 'string' || typeof carrier.promptId !== 'string') return record;
    const existing = prompts[carrier.promptId];
    if (existing !== undefined && existing !== carrier.prompt) return record;
    prompts[carrier.promptId] = carrier.prompt;
    packed = true;
    const copy = { ...(record as PlainRecord) };
    delete copy['prompt'];
    return copy as T;
  });
  return packed ? { records: out, prompts } : { records };
}

/** Restore a prompt that {@link packPrompts} moved out of `record`, in place. */
function restorePrompt(record: PlainRecord, prompts: Record<string, string>): void {
  if (record['prompt'] !== undefined) return;
  const promptId = record['promptId'];
  if (typeof promptId !== 'string') return;
  const prompt = prompts[promptId];
  if (prompt !== undefined) record['prompt'] = prompt;
}

function unpackPrompts(records: unknown[], prompts: Record<string, string> | undefined): unknown[] {
  if (!prompts) return records;
  return records.map((record) => {
    if (!isPlainRecord(record) || record['prompt'] !== undefined) return record;
    const promptId = record['promptId'];
    const prompt = typeof promptId === 'string' ? prompts[promptId] : undefined;
    return prompt === undefined ? record : { ...record, prompt };
  });
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function isPromptTable(value: unknown): value is Record<string, string> | undefined {
  return (
    value === undefined ||
    (isPlainRecord(value) && Object.values(value).every((prompt) => typeof prompt === 'string'))
  );
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length;
}

/**
 * Whether a cell can mark "absent" with `null` without losing information:
 * a stored `null`, or a non-finite number that JSON turns into `null`, could
 * not be told apart from a missing key.
 */
function isColumnSafe(value: unknown): boolean {
  return value !== null && !(typeof value === 'number' && !Number.isFinite(value));
}

/** Keys in first-seen order, or `null` when the records cannot be stored column-wise. */
function columnarKeys(records: unknown[]): string[] | null {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!isPlainRecord(record)) return null;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (value === undefined) continue;
      if (key === PROTOTYPE_KEY || !isColumnSafe(value)) return null;
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

function sharedValue(records: PlainRecord[], key: string): Scalar | undefined {
  const value = records[0]?.[key];
  if (!isScalar(value)) return undefined;
  return records.every((record) => record[key] === value) ? value : undefined;
}

function toColumnar(
  records: PlainRecord[],
  keys: string[],
  warnings: unknown[],
  prompts: Record<string, string> | undefined,
): ColumnarPayload {
  const shared: Record<string, Scalar> = {};
  const columns: string[] = [];
  for (const key of keys) {
    const value = sharedValue(records, key);
    if (value === undefined) columns.push(key);
    else shared[key] = value;
  }
  const rows = records.map((record) => columns.map((key) => record[key] ?? null));
  return {
    format: COLUMNAR_PAYLOAD_FORMAT,
    warnings,
    keys,
    shared,
    columns,
    rows,
    ...(prompts ? { prompts } : {}),
  };
}

/** Serialize records and warnings, column-wise whenever that round-trips exactly. */
export function encodePayload(records: unknown[], warnings: unknown[]): string {
  const packed = packPrompts(records);
  const keys = columnarKeys(packed.records);
  if (keys === null) {
    const rows: RowPayload = { warnings, ...packed };
    return JSON.stringify(rows);
  }
  return JSON.stringify(toColumnar(packed.records as PlainRecord[], keys, warnings, packed.prompts));
}

function isColumnarPayload(value: PlainRecord): value is PlainRecord & ColumnarPayload {
  const { keys, columns, shared, rows } = value;
  if (!isStringList(keys) || keys.includes(PROTOTYPE_KEY) || !isStringList(columns)) return false;
  const known = new Set(keys);
  if (!columns.every((column) => known.has(column))) return false;
  if (!isPlainRecord(shared)) return false;
  const sharedKeys = Object.keys(shared);
  if (sharedKeys.length + columns.length !== keys.length) return false;
  const columnSet = new Set(columns);
  if (!sharedKeys.every((key) => known.has(key) && !columnSet.has(key) && isScalar(shared[key]))) return false;
  return Array.isArray(rows) && rows.every((row) => Array.isArray(row) && row.length === columns.length);
}

function fromColumnar(payload: ColumnarPayload): unknown[] {
  const columnIndex = new Map(payload.columns.map((column, index) => [column, index]));
  // One step per key: either the shared value or a cell index into the row.
  const plan = payload.keys.map((key) => ({ key, cell: columnIndex.get(key) }));
  const { shared, prompts } = payload;
  const records: unknown[] = new Array(payload.rows.length);
  for (let i = 0; i < payload.rows.length; i++) {
    const row = payload.rows[i]!;
    const record: PlainRecord = {};
    for (const { key, cell } of plan) {
      if (cell === undefined) {
        record[key] = shared[key];
        continue;
      }
      const value = row[cell];
      if (value !== null) record[key] = value;
    }
    if (prompts) restorePrompt(record, prompts);
    records[i] = record;
  }
  return records;
}

/**
 * Parse a stored payload in either layout. Returns `null` for anything
 * malformed, so the caller reparses the source file instead.
 */
export function decodePayload(raw: string): DecodedPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || !Array.isArray(value['warnings']) || !isPromptTable(value['prompts'])) return null;
  const warnings = value['warnings'] as unknown[];
  const prompts = value['prompts'] as Record<string, string> | undefined;
  if (value['format'] === COLUMNAR_PAYLOAD_FORMAT) {
    return isColumnarPayload(value) ? { records: fromColumnar(value), warnings } : null;
  }
  if (value['format'] !== undefined || !Array.isArray(value['records'])) return null;
  return { records: unpackPrompts(value['records'] as unknown[], prompts), warnings };
}
