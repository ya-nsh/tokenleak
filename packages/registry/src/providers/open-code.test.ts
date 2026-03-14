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
const CURRENT_DIR = join(TEMP_ROOT, 'current-base');
const EMPTY_DB_DIR = join(TEMP_ROOT, 'empty-db-base');
const BAD_SCHEMA_DIR = join(TEMP_ROOT, 'bad-schema-base');
const BAD_JSON_DIR = join(TEMP_ROOT, 'bad-json-base');
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

  // -- Current storage fixture --
  mkdirSync(join(CURRENT_DIR, 'storage', 'message', 'ses-current-1'), { recursive: true });
  writeFileSync(
    join(CURRENT_DIR, 'storage', 'message', 'ses-current-1', 'msg-user.json'),
    JSON.stringify({
      id: 'msg-user',
      sessionID: 'ses-current-1',
      role: 'user',
      time: { created: 1772704800000 },
    }),
  );
  writeFileSync(
    join(CURRENT_DIR, 'storage', 'message', 'ses-current-1', 'msg-assistant-1.json'),
    JSON.stringify({
      id: 'msg-assistant-1',
      sessionID: 'ses-current-1',
      role: 'assistant',
      time: { created: 1772704860000, completed: 1772704875000 },
      modelID: 'glm-4.7-free',
      providerID: 'opencode',
      cost: 0.42,
      tokens: {
        input: 100,
        output: 20,
        reasoning: 0,
        cache: {
          read: 30,
          write: 5,
        },
      },
    }),
  );
  writeFileSync(
    join(CURRENT_DIR, 'storage', 'message', 'ses-current-1', 'msg-assistant-2.json'),
    JSON.stringify({
      id: 'msg-assistant-2',
      sessionID: 'ses-current-1',
      role: 'assistant',
      time: { created: 1772791260000, completed: 1772791270000 },
      modelID: 'gpt-4o',
      providerID: 'openai',
      cost: 0.15,
      tokens: {
        input: 40,
        output: 10,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    }),
  );
  writeFileSync(
    join(CURRENT_DIR, 'storage', 'message', 'ses-current-1', 'msg-assistant-aborted.json'),
    JSON.stringify({
      id: 'msg-assistant-aborted',
      sessionID: 'ses-current-1',
      role: 'assistant',
      time: { created: 1772791300000 },
      modelID: 'gpt-4o',
      providerID: 'openai',
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    }),
  );

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

  // -- Bad schema DB fixture (no messages table) --
  mkdirSync(BAD_SCHEMA_DIR, { recursive: true });
  const badDb = new Database(join(BAD_SCHEMA_DIR, 'sessions.db'));
  badDb.exec('CREATE TABLE other_table (id TEXT PRIMARY KEY)');
  badDb.close();

  // -- Bad JSON fixture (malformed files) --
  mkdirSync(join(BAD_JSON_DIR, 'sessions'), { recursive: true });
  writeFileSync(join(BAD_JSON_DIR, 'sessions', 'bad.json'), 'not valid json {{{');
  writeFileSync(
    join(BAD_JSON_DIR, 'sessions', 'good.json'),
    JSON.stringify({
      messages: [
        {
          model: 'gpt-4o',
          role: 'assistant',
          usage: { input_tokens: 100, output_tokens: 200 },
          created_at: '2026-03-05T10:00:00Z',
        },
      ],
    }),
  );
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

    test('returns true when current storage/message directory exists', async () => {
      const provider = new OpenCodeProvider(CURRENT_DIR);
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
      expect(data.displayName).toBe('OpenCode');
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

  describe('load — current storage layout', () => {
    test('loads assistant usage from storage/message files', async () => {
      const provider = new OpenCodeProvider(CURRENT_DIR);
      const data = await provider.load(DEFAULT_RANGE);

      expect(data.provider).toBe('open-code');
      expect(data.daily).toHaveLength(2);
      expect(data.totalTokens).toBe(205);
      expect(data.totalCost).toBeCloseTo(0.57, 10);

      const march5 = data.daily.find((d) => d.date === '2026-03-05');
      expect(march5).toBeDefined();
      expect(march5!.inputTokens).toBe(100);
      expect(march5!.outputTokens).toBe(20);
      expect(march5!.cacheReadTokens).toBe(30);
      expect(march5!.cacheWriteTokens).toBe(5);
      expect(march5!.models[0]!.model).toBe('glm-4.7-free');

      const march6 = data.daily.find((d) => d.date === '2026-03-06');
      expect(march6).toBeDefined();
      expect(march6!.totalTokens).toBe(50);
      expect(march6!.models[0]!.cost).toBeCloseTo(0.15, 10);
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

  describe('load — error handling', () => {
    test('returns empty data when SQLite schema is incompatible', async () => {
      const provider = new OpenCodeProvider(BAD_SCHEMA_DIR);
      const data = await provider.load(DEFAULT_RANGE);
      expect(data.daily).toEqual([]);
      expect(data.totalTokens).toBe(0);
    });

    test('skips malformed JSON files and loads valid ones', async () => {
      const provider = new OpenCodeProvider(BAD_JSON_DIR);
      const data = await provider.load(DEFAULT_RANGE);
      // Should load data from good.json, skip bad.json
      expect(data.daily.length).toBe(1);
      expect(data.totalTokens).toBe(300); // 100 + 200
    });
  });

  describe('metadata', () => {
    test('has correct name, displayName, and colors', () => {
      const provider = new OpenCodeProvider();
      expect(provider.name).toBe('open-code');
      expect(provider.displayName).toBe('OpenCode');
      expect(provider.colors).toEqual({
        primary: '#6366f1',
        secondary: '#a78bfa',
        gradient: ['#6366f1', '#a78bfa'],
      });
    });
  });
});
