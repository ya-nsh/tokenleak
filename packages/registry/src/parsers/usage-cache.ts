import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MAX_JSONL_RECORD_BYTES, getTokenleakCacheDir } from '@tokenleak/core';
import type { JsonlRecordWarning } from './jsonl-splitter';

interface ParsedFile<T> {
  records: T[];
  warnings: JsonlRecordWarning[];
}

interface CacheEntry<T> extends ParsedFile<T> {
  stamp: string;
  /**
   * Prompt text keyed by promptId. Every assistant message in a turn carries
   * the same prompt, so storing it once per file shrinks the Claude Code
   * cache several-fold.
   */
  prompts?: Record<string, string>;
}

/** v2: prompts are stored once per file in `prompts`, not on every record. */
const CACHE_FORMAT_VERSION = 2;
/** Leftover temp files from crashed writes. */
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1_000;
/** Caches for roots that have not been read in this long are dropped. */
const UNUSED_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
/** Files written before caches were named by namespace. */
const LEGACY_CACHE_FILE = /^[0-9a-f]{64}\.json$/;
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

function stamp(file: string): string {
  const s = statSync(file, { bigint: true });
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
}

/** Stores unpriced, unfiltered usage, never full transcript records. */
export class UsageFileCache<T> {
  private previous: Record<string, CacheEntry<T>> = {};
  private current: Record<string, CacheEntry<T>> = {};
  private dirty = false;
  private readonly directory: string;
  private readonly path: string;
  private readonly disabled: boolean;
  private readonly fileName: string;
  private readonly family: string;
  private readonly version: string | null;

  constructor(
    namespace: string,
    root: string,
    private readonly validateRecord: (value: unknown) => boolean,
  ) {
    this.disabled = process.env['TOKENLEAK_USAGE_CACHE'] === '0';
    this.directory =
      process.env['TOKENLEAK_USAGE_CACHE_DIR'] ?? join(getTokenleakCacheDir(), 'usage');
    // Parser versions and the record-size policy are part of the cache identity.
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          namespace,
          resolve(root),
          process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'] ?? MAX_JSONL_RECORD_BYTES,
        ]),
      )
      .digest('hex');
    ({ family: this.family, version: this.version } = parseNamespace(namespace));
    // Named by namespace so stale versions can be found and removed.
    this.fileName = `${namespace}-${key}.json`;
    this.path = join(this.directory, this.fileName);
    if (this.disabled) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (parsed?.version === CACHE_FORMAT_VERSION && parsed.entries && typeof parsed.entries === 'object') {
        this.previous = parsed.entries;
        // Mark the cache as in use so pruning keeps it even when nothing changed.
        const now = new Date();
        utimesSync(this.path, now, now);
      }
    } catch {
      // Missing or corrupt caches are rebuilt from the source.
    }
  }

  private prune(): void {
    pruneUsageCacheDirectory(this.directory, {
      family: this.family,
      version: this.version,
      fileName: this.fileName,
    });
  }

  async read(file: string, parse: () => Promise<ParsedFile<T>>): Promise<ParsedFile<T>> {
    if (this.disabled) return parse();
    const before = stamp(file);
    const cached = this.previous[file];
    if (
      cached?.stamp === before &&
      Array.isArray(cached.records) &&
      isPromptTable(cached.prompts) &&
      cached.records.every(this.validateRecord) &&
      Array.isArray(cached.warnings) &&
      cached.warnings.every(
        (warning) =>
          warning !== null &&
          typeof warning === 'object' &&
          (warning.kind === 'parse' || warning.kind === 'oversize') &&
          warning.file === file &&
          Number.isInteger(warning.line) &&
          warning.line > 0,
      )
    ) {
      this.current[file] = cached;
      return { records: unpackPrompts(cached.records, cached.prompts), warnings: cached.warnings };
    }
    const result = await parse();
    // A live session can grow during a read. Never cache an inconsistent snapshot.
    if (stamp(file) === before) {
      this.current[file] = { stamp: before, warnings: result.warnings, ...packPrompts(result.records) };
    }
    this.dirty = true;
    return result;
  }

  async save(): Promise<void> {
    if (this.disabled) return;
    this.prune();
    if (!this.dirty && Object.keys(this.previous).length === Object.keys(this.current).length) return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify({ version: CACHE_FORMAT_VERSION, entries: this.current }), {
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } catch {
      // Cache failures must not make local usage unavailable.
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}

/**
 * Remove cache files nobody will read again: crashed-write temp files,
 * pre-namespace files, other versions of this namespace, and this
 * namespace's caches for roots unused for 30 days. Best effort only.
 */
export function pruneUsageCacheDirectory(
  directory: string,
  keep: { family: string; version: string | null; fileName: string },
  now: number = Date.now(),
): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return removed;
  }
  const familyPrefix = `${keep.family}-v`;
  for (const name of names) {
    if (name === keep.fileName) continue;
    const path = join(directory, name);
    let ageMs: number;
    try {
      ageMs = now - statSync(path).mtimeMs;
    } catch {
      continue;
    }
    const isTemp = name.endsWith('.tmp');
    const isLegacy = LEGACY_CACHE_FILE.test(name);
    let sameFamily = false;
    let otherVersion = false;
    if (name.startsWith(familyPrefix) && name.endsWith('.json')) {
      const version = /^v(\d+)-[0-9a-f]{64}\.json$/.exec(name.slice(keep.family.length + 1))?.[1];
      if (version !== undefined) {
        sameFamily = true;
        otherVersion = version !== keep.version;
      }
    }
    const stale =
      (isTemp && ageMs > TEMP_FILE_MAX_AGE_MS) ||
      isLegacy ||
      otherVersion ||
      (sameFamily && ageMs > UNUSED_CACHE_MAX_AGE_MS);
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
