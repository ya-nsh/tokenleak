import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MAX_JSONL_RECORD_BYTES } from '@tokenleak/core';
import type { JsonlRecordWarning } from './jsonl-splitter';

interface ParsedFile<T> {
  records: T[];
  warnings: JsonlRecordWarning[];
}

interface CacheEntry<T> extends ParsedFile<T> {
  stamp: string;
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

  constructor(namespace: string, root: string) {
    this.disabled = process.env['TOKENLEAK_USAGE_CACHE'] === '0';
    this.directory =
      process.env['TOKENLEAK_USAGE_CACHE_DIR'] ?? join(homedir(), '.cache', 'tokenleak', 'usage');
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
    this.path = join(this.directory, `${key}.json`);
    if (this.disabled) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        this.previous = parsed.entries;
      }
    } catch {
      // Missing or corrupt caches are rebuilt from the source.
    }
  }

  async read(file: string, parse: () => Promise<ParsedFile<T>>): Promise<ParsedFile<T>> {
    if (this.disabled) return parse();
    const before = stamp(file);
    const cached = this.previous[file];
    if (
      cached?.stamp === before &&
      Array.isArray(cached.records) &&
      Array.isArray(cached.warnings)
    ) {
      this.current[file] = cached;
      return { records: cached.records, warnings: cached.warnings };
    }
    const result = await parse();
    // A live session can grow during a read. Never cache an inconsistent snapshot.
    if (stamp(file) === before) {
      this.current[file] = { stamp: before, ...result };
    }
    this.dirty = true;
    return result;
  }

  async save(): Promise<void> {
    if (
      this.disabled ||
      (!this.dirty && Object.keys(this.previous).length === Object.keys(this.current).length)
    )
      return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify({ version: 1, entries: this.current }), {
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
