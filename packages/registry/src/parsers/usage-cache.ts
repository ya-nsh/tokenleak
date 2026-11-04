import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { chmodSync, closeSync, mkdirSync, openSync, readSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MAX_JSONL_RECORD_BYTES, SUPERSEDED_CACHE_MAX_IDLE_MS, getTokenleakCacheDir } from '@tokenleak/core';
import type { JsonlRecordWarning } from './jsonl-splitter';

export interface ParsedFile<T> {
  records: T[];
  warnings: JsonlRecordWarning[];
}

/** Where an appendable parse stopped: just past its last newline-terminated line. */
export interface ResumePoint<S> {
  offset: number;
  lineNumber: number;
  state: S;
}

export interface AppendableParse<T, S> extends ParsedFile<T>, ResumePoint<S> {
  /**
   * How many trailing `records` and `warnings` came from an unterminated final
   * line. A writer may still be appending to it, so resuming drops them and
   * reads that line again.
   */
  tailRecords: number;
  tailWarnings: number;
}

/**
 * A parser that can continue from a {@link ResumePoint}. Given `null` it reads
 * the whole file; given a point it reads only the bytes after it, carrying
 * `state` forward, so an appended log costs only its new lines.
 */
export interface AppendableParser<T, S> {
  parse(from: ResumePoint<S> | null): Promise<AppendableParse<T, S>>;
  isState(value: unknown): value is S;
}

interface StoredPayload<T> extends ParsedFile<T> {
  /**
   * Prompt text keyed by promptId. Every assistant message in a turn carries
   * the same prompt, so storing it once per file shrinks the Claude Code
   * cache several-fold.
   */
  prompts?: Record<string, string>;
}

interface StoredResume {
  dev: string;
  ino: string;
  offset: number;
  lineNumber: number;
  state: unknown;
  tailRecords: number;
  tailWarnings: number;
  /** Hashes of the bytes at the start of the file and just before `offset`. */
  head: string;
  tail: string;
}

interface PendingEntry {
  stamp: string;
  payload: string;
  resume: string | null;
}

interface FileIdentity {
  stamp: string;
  dev: string;
  ino: string;
  size: bigint;
}

const STORE_FILE_NAME = 'usage.sqlite';
/** Bumped when the table layout changes; older stores are rebuilt. */
const STORE_SCHEMA_VERSION = 1;
/** How long a write waits for another tokenleak process holding the lock. */
const BUSY_TIMEOUT_MS = 2_000;
/** Bytes hashed at each end of the consumed prefix to detect rewritten files. */
const ANCHOR_BYTES = 4_096;
/** Leftover temp files from crashed writes of the retired JSON caches. */
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1_000;
/** Caches for roots that have not been read in this long are dropped. */
const UNUSED_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
/** Per-root JSON caches written before the SQLite store, by namespace or by bare hash. */
const RETIRED_JSON_CACHE = /^(?:[a-z0-9-]+-v\d+-)?[0-9a-f]{64}\.json$/;
const NAMESPACE_VERSION = /^(.*)-v(\d+)$/;

function parseNamespace(namespace: string): { family: string; version: string | null } {
  const match = NAMESPACE_VERSION.exec(namespace);
  return match ? { family: match[1]!, version: match[2]! } : { family: namespace, version: null };
}

type PromptCarrier = { prompt?: unknown; promptId?: unknown };

/** Move repeated prompt text into a per-file table. Returns new records. */
function packPrompts<T>(records: T[]): { records: T[]; prompts?: Record<string, string> } {
  const prompts: Record<string, string> = {};
  let packed = false;
  const out = records.map((record) => {
    const carrier = record as PromptCarrier;
    if (typeof carrier.prompt !== 'string' || typeof carrier.promptId !== 'string') return record;
    const existing = prompts[carrier.promptId];
    if (existing !== undefined && existing !== carrier.prompt) return record;
    prompts[carrier.promptId] = carrier.prompt;
    packed = true;
    const copy = { ...(record as Record<string, unknown>) };
    delete copy['prompt'];
    return copy as T;
  });
  return packed ? { records: out, prompts } : { records };
}

function unpackPrompts<T>(records: T[], prompts: Record<string, string> | undefined): T[] {
  if (!prompts) return records;
  return records.map((record) => {
    const carrier = record as PromptCarrier;
    if (carrier.prompt !== undefined || typeof carrier.promptId !== 'string') return record;
    const prompt = prompts[carrier.promptId];
    return prompt === undefined ? record : ({ ...(record as Record<string, unknown>), prompt } as T);
  });
}

function isPromptTable(value: unknown): value is Record<string, string> {
  return (
    value === undefined ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((prompt) => typeof prompt === 'string'))
  );
}

function identify(file: string): FileIdentity {
  const s = statSync(file, { bigint: true });
  return {
    stamp: `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`,
    dev: String(s.dev),
    ino: String(s.ino),
    size: s.size,
  };
}

function hashRange(fd: number, start: number, end: number): string {
  const length = Math.max(0, end - start);
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = readSync(fd, buffer, read, length - read, start + read);
    if (n === 0) break;
    read += n;
  }
  return createHash('sha256').update(buffer.subarray(0, read)).digest('hex');
}

/** Fingerprints the consumed prefix by its first and last few KiB. */
function anchors(file: string, offset: number): { head: string; tail: string } {
  const fd = openSync(file, 'r');
  try {
    return {
      head: hashRange(fd, 0, Math.min(ANCHOR_BYTES, offset)),
      tail: hashRange(fd, Math.max(0, offset - ANCHOR_BYTES), offset),
    };
  } finally {
    closeSync(fd);
  }
}

function isWarningFor(file: string, warning: unknown): warning is JsonlRecordWarning {
  if (warning === null || typeof warning !== 'object') return false;
  const w = warning as Record<string, unknown>;
  return (
    (w['kind'] === 'parse' || w['kind'] === 'oversize') &&
    w['file'] === file &&
    typeof w['line'] === 'number' &&
    Number.isInteger(w['line']) &&
    w['line'] > 0
  );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function decodeResume(raw: string | null): StoredResume | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value['dev'] === 'string' &&
      typeof value['ino'] === 'string' &&
      isCount(value['offset']) &&
      isCount(value['lineNumber']) &&
      isCount(value['tailRecords']) &&
      isCount(value['tailWarnings']) &&
      typeof value['head'] === 'string' &&
      typeof value['tail'] === 'string'
    ) {
      return value as unknown as StoredResume;
    }
  } catch {
    // Unreadable resume data only costs a full parse.
  }
  return null;
}

function openStore(directory: string): Database | null {
  const path = join(directory, STORE_FILE_NAME);
  for (let attempt = 0; attempt < 2; attempt++) {
    let db: Database | null = null;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      db = new Database(path, { create: true });
      chmodSync(path, 0o600);
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      const { user_version: version } = db.query('PRAGMA user_version').get() as { user_version: number };
      if (version !== STORE_SCHEMA_VERSION) {
        db.exec('DROP TABLE IF EXISTS entries');
        db.exec('DROP TABLE IF EXISTS caches');
      }
      db.exec(`CREATE TABLE IF NOT EXISTS caches (
        cache_key TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        version TEXT,
        last_used INTEGER NOT NULL
      )`);
      // Payloads average over 100 KiB; SQLite stores rows that large far better
      // in a rowid table than in a WITHOUT ROWID one keyed by (cache_key, file).
      db.exec(`CREATE TABLE IF NOT EXISTS entries (
        cache_key TEXT NOT NULL,
        file TEXT NOT NULL,
        stamp TEXT NOT NULL,
        payload TEXT NOT NULL,
        resume TEXT,
        UNIQUE (cache_key, file)
      )`);
      db.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION}`);
      return db;
    } catch {
      db?.close();
      // A corrupt store is rebuilt once; an unwritable location disables caching.
      if (attempt > 0) return null;
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          rmSync(`${path}${suffix}`, { force: true });
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Stores unpriced, unfiltered usage per source file, never full transcript
 * records, in one SQLite database shared by every provider and root.
 *
 * An unchanged file is a single row lookup. Only changed rows are written,
 * so a growing session no longer rewrites the whole cache. Files read through
 * {@link UsageFileCache.readAppendable} also resume after their last parsed
 * line when they have only grown.
 */
export class UsageFileCache<T> {
  private readonly db: Database | null;
  private readonly cacheKey: string;
  private readonly directory: string;
  private readonly family: string;
  private readonly version: string | null;
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, PendingEntry>();

  constructor(
    namespace: string,
    root: string,
    private readonly validateRecord: (value: unknown) => boolean,
  ) {
    this.directory =
      process.env['TOKENLEAK_USAGE_CACHE_DIR'] ?? join(getTokenleakCacheDir(), 'usage');
    // Parser versions and the record-size policy are part of the cache identity.
    this.cacheKey = createHash('sha256')
      .update(
        JSON.stringify([
          namespace,
          resolve(root),
          process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'] ?? MAX_JSONL_RECORD_BYTES,
        ]),
      )
      .digest('hex');
    ({ family: this.family, version: this.version } = parseNamespace(namespace));
    this.db = process.env['TOKENLEAK_USAGE_CACHE'] === '0' ? null : openStore(this.directory);
  }

  private lookup(file: string): { stamp: string; payload: string; resume: string | null } | null {
    if (!this.db) return null;
    try {
      return (
        (this.db
          .query('SELECT stamp, payload, resume FROM entries WHERE cache_key = ? AND file = ?')
          .get(this.cacheKey, file) as { stamp: string; payload: string; resume: string | null } | null) ??
        null
      );
    } catch {
      return null;
    }
  }

  private decodePayload(file: string, raw: string): ParsedFile<T> | null {
    try {
      const payload = JSON.parse(raw) as StoredPayload<unknown>;
      if (
        Array.isArray(payload.records) &&
        isPromptTable(payload.prompts) &&
        payload.records.every(this.validateRecord) &&
        Array.isArray(payload.warnings) &&
        payload.warnings.every((warning) => isWarningFor(file, warning))
      ) {
        return { records: unpackPrompts(payload.records as T[], payload.prompts), warnings: payload.warnings };
      }
    } catch {
      // Invalid payloads are reparsed from the source.
    }
    return null;
  }

  private encodePayload(result: ParsedFile<T>): string {
    return JSON.stringify({ warnings: result.warnings, ...packPrompts(result.records) });
  }

  async read(file: string, parse: () => Promise<ParsedFile<T>>): Promise<ParsedFile<T>> {
    if (!this.db) return parse();
    const before = identify(file);
    this.seen.add(file);
    const row = this.lookup(file);
    if (row?.stamp === before.stamp) {
      const cached = this.decodePayload(file, row.payload);
      if (cached) return cached;
    }
    const result = await parse();
    // A live session can grow during a read. Never cache an inconsistent snapshot.
    if (identify(file).stamp === before.stamp) {
      this.pending.set(file, { stamp: before.stamp, payload: this.encodePayload(result), resume: null });
    }
    return result;
  }

  /**
   * Like {@link read}, but a file that has only grown since it was cached is
   * parsed from where the previous parse stopped. Growth is trusted only when
   * the device and inode match and the first and last few KiB of the consumed
   * prefix hash the same; anything else is reparsed from the start.
   */
  async readAppendable<S>(file: string, parser: AppendableParser<T, S>): Promise<ParsedFile<T>> {
    if (!this.db) return stripResume(await parser.parse(null));
    const before = identify(file);
    this.seen.add(file);
    const row = this.lookup(file);
    if (row?.stamp === before.stamp) {
      const cached = this.decodePayload(file, row.payload);
      if (cached) return cached;
    }

    let base: ParsedFile<T> | null = null;
    let from: ResumePoint<S> | null = null;
    const resume = row ? decodeResume(row.resume) : null;
    if (
      row &&
      resume &&
      resume.dev === before.dev &&
      resume.ino === before.ino &&
      BigInt(resume.offset) <= before.size &&
      parser.isState(resume.state)
    ) {
      const cached = this.decodePayload(file, row.payload);
      const current = anchors(file, resume.offset);
      if (
        cached &&
        current.head === resume.head &&
        current.tail === resume.tail &&
        resume.tailRecords <= cached.records.length &&
        resume.tailWarnings <= cached.warnings.length
      ) {
        base = {
          records: cached.records.slice(0, cached.records.length - resume.tailRecords),
          warnings: cached.warnings.slice(0, cached.warnings.length - resume.tailWarnings),
        };
        from = { offset: resume.offset, lineNumber: resume.lineNumber, state: resume.state };
      }
    }

    const parsed = await parser.parse(from);
    const result: ParsedFile<T> = base
      ? { records: [...base.records, ...parsed.records], warnings: [...base.warnings, ...parsed.warnings] }
      : stripResume(parsed);
    // Fingerprint before the final stat, so a change after parsing is caught too.
    const fingerprint = anchors(file, parsed.offset);
    if (identify(file).stamp === before.stamp) {
      const stored: StoredResume = {
        dev: before.dev,
        ino: before.ino,
        offset: parsed.offset,
        lineNumber: parsed.lineNumber,
        state: parsed.state,
        tailRecords: parsed.tailRecords,
        tailWarnings: parsed.tailWarnings,
        ...fingerprint,
      };
      this.pending.set(file, {
        stamp: before.stamp,
        payload: this.encodePayload(result),
        resume: JSON.stringify(stored),
      });
    }
    return result;
  }

  /** Writes changed files, forgets files that no longer exist, and prunes stale caches. */
  async save(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const now = Date.now();
    try {
      db.transaction(() => {
        const upsert = db.query(
          `INSERT INTO entries (cache_key, file, stamp, payload, resume) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (cache_key, file) DO UPDATE SET stamp = excluded.stamp, payload = excluded.payload, resume = excluded.resume`,
        );
        for (const [file, entry] of this.pending) {
          upsert.run(this.cacheKey, file, entry.stamp, entry.payload, entry.resume);
        }
        const remove = db.query('DELETE FROM entries WHERE cache_key = ? AND file = ?');
        const stored = db.query('SELECT file FROM entries WHERE cache_key = ?').values(this.cacheKey) as [string][];
        for (const [file] of stored) {
          if (!this.seen.has(file)) remove.run(this.cacheKey, file);
        }
        db.query(
          `INSERT INTO caches (cache_key, family, version, last_used) VALUES (?, ?, ?, ?)
           ON CONFLICT (cache_key) DO UPDATE SET last_used = excluded.last_used`,
        ).run(this.cacheKey, this.family, this.version, now);
        // Other parser versions of this provider once no installed version has
        // used them for a week, and roots unused for 30 days.
        const stale = db
          .query(
            `SELECT cache_key FROM caches
             WHERE family = ? AND cache_key != ?
               AND ((version IS NOT ? AND last_used < ?) OR last_used < ?)`,
          )
          .values(
            this.family,
            this.cacheKey,
            this.version,
            now - SUPERSEDED_CACHE_MAX_IDLE_MS,
            now - UNUSED_CACHE_MAX_AGE_MS,
          ) as [string][];
        for (const [key] of stale) {
          db.query('DELETE FROM entries WHERE cache_key = ?').run(key);
          db.query('DELETE FROM caches WHERE cache_key = ?').run(key);
        }
      })();
    } catch {
      // Cache failures must not make local usage unavailable.
    } finally {
      this.pending.clear();
      db.close();
    }
    pruneRetiredJsonCaches(this.directory, now);
  }
}

function stripResume<T, S>(parsed: AppendableParse<T, S>): ParsedFile<T> {
  return { records: parsed.records, warnings: parsed.warnings };
}

/**
 * Remove the per-root JSON caches that predate the SQLite store, and temp
 * files from their crashed writes. Best effort only.
 *
 * Releases before the SQLite store still read and write those JSON caches, so
 * one is removed only after a week without writes: running an older install
 * next to this one must not leave it to reparse every log from scratch.
 */
export function pruneRetiredJsonCaches(directory: string, now: number = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return removed;
  }
  for (const name of names) {
    const path = join(directory, name);
    const maxIdleMs = RETIRED_JSON_CACHE.test(name)
      ? SUPERSEDED_CACHE_MAX_IDLE_MS
      : name.endsWith('.tmp')
        ? TEMP_FILE_MAX_AGE_MS
        : null;
    if (maxIdleMs === null) continue;
    let stale: boolean;
    try {
      stale = now - statSync(path).mtimeMs > maxIdleMs;
    } catch {
      continue;
    }
    if (!stale) continue;
    try {
      rmSync(path, { force: true });
      removed.push(name);
    } catch {
      // Another process may own it; leave it for next time.
    }
  }
  return removed;
}

/** Validate the unpriced record schema shared by the transcript providers. */
export function isCachedUsageRecord(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!['date', 'timestamp', 'model'].every((key) => typeof record[key] === 'string')) return false;
  if (
    !['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].every(
      (key) => typeof record[key] === 'number' && Number.isFinite(record[key]),
    )
  )
    return false;
  if (
    ![
      'prompt',
      'promptId',
      'sessionId',
      'projectId',
      'messageId',
      'turnId',
      'responseId',
      'serviceTier',
      'serviceTierSource',
      'inferenceGeo',
    ].every((key) => record[key] === undefined || typeof record[key] === 'string')
  )
    return false;
  const longTtlWrites = record['cacheWrite1hTokens'];
  if (
    longTtlWrites !== undefined &&
    (typeof longTtlWrites !== 'number' || !Number.isFinite(longTtlWrites) || longTtlWrites < 0)
  )
    return false;
  if (
    !['counterAdvanced', 'cumulativeOnly'].every(
      (key) => record[key] === undefined || typeof record[key] === 'boolean',
    )
  )
    return false;
  if (record['serviceTierSource'] !== undefined && !['response', 'request', 'model-name'].includes(record['serviceTierSource'] as string)) return false;
  return (
    record['source'] === undefined ||
    record['source'] === 'record' ||
    record['source'] === 'notification'
  );
}
