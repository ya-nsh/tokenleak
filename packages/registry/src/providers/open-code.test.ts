import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { OpenCodeProvider } from './open-code';
import type { DateRange } from '@tokenleak/core';

const TEMP_ROOT = join(tmpdir(), `opencode-test-${Date.now()}`);
const SQLITE_DIR = join(TEMP_ROOT, 'sqlite-base');
const JSON_DIR = join(TEMP_ROOT, 'json-base');
const EMPTY_DB_DIR = join(TEMP_ROOT, 'empty-db-base');
const MISSING_DIR = join(TEMP_ROOT, 'nonexistent');

const DEFAULT_RANGE: DateRange = {
  since: '2026-01-01',
  until: '2026-12-31',
};

const NARROW_RANGE: DateRange = {
  since: '2026-03-01',
  until: '2026-03-10',
};

beforeAll(() => {
  // -- SQLite fixture --
  mkdirSync(SQLITE_DIR, { recursive: true });
  const db = new Database(join(SQLITE_DIR, 'sessions.db'));
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT
    )
  `);

  const insert = db.prepare(
    'INSERT INTO messages (id, session_id, role, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  // Assistant messages — these should be counted
  insert.run('1', 's1', 'assistant', 'claude-sonnet-4-20250514', 500, 1000, '1740787200'); // 2025-03-01 (Unix)
  insert.run('2', 's1', 'assistant', 'claude-sonnet-4-20250514', 600, 800, '2026-03-05T12:00:00Z'); // ISO
  insert.run('3', 's2', 'assistant', 'gpt-4o', 200, 300, '2026-03-05T14:00:00Z');
  insert.run('4', 's2', 'assistant', 'claude-sonnet-4-20250514', 100, 200, '2026-03-10T10:00:00Z');
  // User message — should be ignored
  insert.run('5', 's1', 'user', 'claude-sonnet-4-20250514', 50, 0, '2026-03-05T11:00:00Z');

  db.close();

  // -- JSON fixture --
  mkdirSync(join(JSON_DIR, 'sessions'), { recursive: true });

  const session1 = {
    messages: [
      { model: 'claude-sonnet-4-20250514', role: 'user', created_at: '2026-03-05T10:00:00Z' },
      {
        model: 'claude-sonnet-4-20250514',
        role: 'assistant',
        usage: { input_tokens: 400, output_tokens: 600 },
        created_at: '2026-03-05T10:01:00Z',
      },
      {
        model: 'gpt-4o',
        role: 'assistant',
        usage: { input_tokens: 150, output_tokens: 250 },
        created_at: '2026-03-06T09:00:00Z',
      },
    ],
  };

  const session2 = {
    messages: [
      {
        model: 'claude-sonnet-4-20250514',
        role: 'assistant',
        usage: { input_tokens: 300, output_tokens: 500 },
        created_at: '2026-03-07T15:00:00Z',
      },
    ],
  };

  writeFileSync(join(JSON_DIR, 'sessions', 'session1.json'), JSON.stringify(session1));
  writeFileSync(join(JSON_DIR, 'sessions', 'session2.json'), JSON.stringify(session2));

  // -- Empty DB fixture --
  mkdirSync(EMPTY_DB_DIR, { recursive: true });
  const emptyDb = new Database(join(EMPTY_DB_DIR, 'sessions.db'));
  emptyDb.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT
    )
  `);
  emptyDb.close();
});

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe('OpenCodeProvider', () => {
  describe('isAvailable', () => {
    test('returns true when sessions.db exists', async () => {
      const provider = new OpenCodeProvider(SQLITE_DIR);
      expect(await provider.isAvailable()).toBe(true);
    });

    test('returns true when sessions/ directory exists', async () => {
      const provider = new OpenCodeProvider(JSON_DIR);
      expect(await provider.isAvailable()).toBe(true);
    });

    test('returns false when base directory does not exist', async () => {
      const provider = new OpenCodeProvider(MISSING_DIR);
      expect(await provider.isAvailable()).toBe(false);
    });

    test('never throws', async () => {
      const provider = new OpenCodeProvider('/nonexistent/path/that/is/invalid');
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('load — SQLite happy path', () => {
    test('loads and aggregates data from SQLite DB', async () => {
      const provider = new OpenCodeProvider(SQLITE_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      expect(data.provider).toBe('open-code');
      expect(data.displayName).toBe('Open Code');
      expect(data.daily.length).toBeGreaterThan(0);
      expect(data.totalTokens).toBeGreaterThan(0);

      // Check that all daily entries are sorted
      for (let i = 1; i < data.daily.length; i++) {
        expect(data.daily[i]!.date >= data.daily[i - 1]!.date).toBe(true);
      }
    });

    test('groups multiple messages on the same date', async () => {
      const provider = new OpenCodeProvider(SQLITE_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      // 2026-03-05 has two assistant messages (claude-sonnet-4 + gpt-4o)
      const march5 = data.daily.find((d) => d.date === '2026-03-05');
      expect(march5).toBeDefined();
      expect(march5!.models.length).toBe(2);
    });

    test('cache tokens are always 0', async () => {
      const provider = new OpenCodeProvider(SQLITE_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      for (const day of data.daily) {
        expect(day.cacheReadTokens).toBe(0);
        expect(day.cacheWriteTokens).toBe(0);
        for (const model of day.models) {
          expect(model.cacheReadTokens).toBe(0);
          expect(model.cacheWriteTokens).toBe(0);
        }
      }
    });
  });

  describe('load — JSON fallback', () => {
    test('loads data from JSON session files when no SQLite DB', async () => {
      const provider = new OpenCodeProvider(JSON_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      expect(data.provider).toBe('open-code');
      expect(data.daily.length).toBeGreaterThan(0);
      expect(data.totalTokens).toBeGreaterThan(0);

      // Should have data on 3 dates: 03-05, 03-06, 03-07
      expect(data.daily.length).toBe(3);
    });

    test('ignores user messages in JSON', async () => {
      const provider = new OpenCodeProvider(JSON_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      // Total tokens should only reflect assistant messages
      // session1: 400+600 + 150+250 = 1400
      // session2: 300+500 = 800
      // total = 2200
      expect(data.totalTokens).toBe(2200);
    });
  });

  describe('load — empty DB', () => {
    test('returns empty daily array for empty database', async () => {
      const provider = new OpenCodeProvider(EMPTY_DB_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      expect(data.daily).toEqual([]);
      expect(data.totalTokens).toBe(0);
      expect(data.totalCost).toBe(0);
    });
  });

  describe('load — date filtering', () => {
    test('filters records by date range', async () => {
      const provider = new OpenCodeProvider(SQLITE_DIR);
      const data = await provider.load(NARROW_RANGE);

      // Only 2026-03-05 and 2026-03-10 should be within 03-01..03-10
      // 2025-03-01 should be excluded (different year)
      for (const day of data.daily) {
        expect(day.date >= NARROW_RANGE.since).toBe(true);
        expect(day.date <= NARROW_RANGE.until).toBe(true);
      }

      // Should NOT include the 2025-03-01 record
      const has2025 = data.daily.some((d) => d.date.startsWith('2025'));
      expect(has2025).toBe(false);
    });

    test('returns empty when range has no matching data', async () => {
      const provider = new OpenCodeProvider(SQLITE_DIR);
      const data = await provider.load({ since: '2020-01-01', until: '2020-12-31' });

      expect(data.daily).toEqual([]);
      expect(data.totalTokens).toBe(0);
    });
  });

  describe('load — model normalization', () => {
    test('strips date suffix from model names', async () => {
      const provider = new OpenCodeProvider(SQLITE_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      const allModels = data.daily.flatMap((d) => d.models.map((m) => m.model));
      // claude-sonnet-4-20250514 should become claude-sonnet-4
      expect(allModels).toContain('claude-sonnet-4');
      expect(allModels).not.toContain('claude-sonnet-4-20250514');
    });
  });

  describe('metadata', () => {
    test('has correct name, displayName, and colors', () => {
      const provider = new OpenCodeProvider();
      expect(provider.name).toBe('open-code');
      expect(provider.displayName).toBe('Open Code');
      expect(provider.colors).toEqual({
        primary: '#6366f1',
        secondary: '#a78bfa',
        gradient: ['#6366f1', '#a78bfa'],
      });
    });
  });
});
