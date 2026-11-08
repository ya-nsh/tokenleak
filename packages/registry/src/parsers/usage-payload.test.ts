import { describe, expect, test } from 'bun:test';
import { COLUMNAR_PAYLOAD_FORMAT, decodePayload, encodePayload } from './usage-payload';

const SESSION = 'projects/-Users-me-work-app/0b6c1f0e-8d4c-4c7a-9a39-5f0c6c0d1e2f.jsonl';
const warning = { kind: 'parse', file: '/logs/a.jsonl', line: 3 };

function usage(i: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: i < 2 ? '2026-01-31' : '2026-02-01',
    timestamp: `2026-02-01T00:00:0${i}.000Z`,
    model: 'claude-sonnet-4-5',
    inputTokens: 10 + i,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sessionId: SESSION,
    projectId: 'projects/-Users-me-work-app',
    ...extra,
  };
}

function roundTrip(records: unknown[], warnings: unknown[] = []) {
  const raw = encodePayload(records, warnings);
  return { raw, parsed: JSON.parse(raw) as Record<string, unknown>, decoded: decodePayload(raw) };
}

describe('encodePayload', () => {
  test('stores values every record shares once and the rest as rows', () => {
    const records = [0, 1, 2, 3].map((i) => usage(i));
    const { raw, parsed, decoded } = roundTrip(records, [warning]);

    expect(parsed['format']).toBe(COLUMNAR_PAYLOAD_FORMAT);
    expect(parsed['shared']).toMatchObject({ sessionId: SESSION, model: 'claude-sonnet-4-5', outputTokens: 5 });
    expect(parsed['columns']).toEqual(['date', 'timestamp', 'inputTokens']);
    expect(raw.split(SESSION).length - 1).toBe(1);
    expect(decoded).toEqual({ records, warnings: [warning] });
  });

  test('is much smaller than one object per record', () => {
    const records = Array.from({ length: 50 }, (_, i) => usage(i % 10, { messageId: `msg_${i}` }));
    const rowSize = JSON.stringify({ warnings: [], records }).length;
    expect(encodePayload(records, []).length).toBeLessThan(rowSize / 2);
  });

  test('keeps optional keys absent on the records that lack them', () => {
    const records = [usage(0, { serviceTier: 'fast', cacheWrite1hTokens: 4 }), usage(1), usage(2, { serviceTier: 'fast' })];
    const decoded = roundTrip(records).decoded!;
    expect(decoded.records).toEqual(records);
    expect(Object.keys(decoded.records[1] as object)).not.toContain('serviceTier');
    expect(Object.keys(decoded.records[0] as object)).toEqual(Object.keys(records[0]!));
  });

  test('drops undefined values the same way JSON does', () => {
    const decoded = roundTrip([usage(0, { prompt: undefined }), usage(1)]).decoded!;
    expect(decoded.records).toEqual([usage(0), usage(1)]);
    expect(Object.keys(decoded.records[0] as object)).not.toContain('prompt');
  });

  test('round-trips nested values, booleans and zero in columns', () => {
    const records = [
      { n: 0, flag: false, nested: { a: [1, null] } },
      { n: 1, flag: true, nested: { a: [] } },
    ];
    expect(roundTrip(records).decoded!.records).toEqual(records);
  });

  test('a single record stores everything as shared values', () => {
    const { parsed, decoded } = roundTrip([usage(0)]);
    expect(parsed['columns']).toEqual([]);
    expect(decoded!.records).toEqual([usage(0)]);
  });

  test('an empty file round-trips', () => {
    expect(roundTrip([], [warning]).decoded).toEqual({ records: [], warnings: [warning] });
  });

  test('packs prompts per turn and restores them, keeping disagreeing text', () => {
    const prompt = 'refactor the parser '.repeat(20);
    const records = [
      usage(0, { prompt, promptId: 'user:1' }),
      usage(1, { prompt, promptId: 'user:1' }),
      usage(2, { prompt: 'edited later', promptId: 'user:1' }),
      usage(3, { promptId: 'user:2' }),
    ];
    const { raw, decoded } = roundTrip(records);
    expect(raw.split('refactor the parser').length - 1).toBe(20);
    expect(decoded!.records).toEqual(records);
  });

  test('falls back to rows when null values or odd records cannot be stored as columns', () => {
    for (const records of [
      [usage(0, { region: null }), usage(1)],
      [usage(0, { ratio: Number.NaN })],
      [usage(0), 'not an object'],
      [[1, 2]],
      [JSON.parse('{"__proto__": {"polluted": true}, "n": 1}') as Record<string, unknown>],
    ]) {
      const { parsed, decoded } = roundTrip(records);
      expect(parsed['format']).toBeUndefined();
      expect(decoded!.records).toEqual(JSON.parse(JSON.stringify(records)) as unknown[]);
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('decodePayload', () => {
  const valid = encodePayload([usage(0), usage(1)], []);
  const tamper = (change: (payload: Record<string, unknown>) => void): string => {
    const payload = JSON.parse(valid) as Record<string, unknown>;
    change(payload);
    return JSON.stringify(payload);
  };

  test('reads the row layout written before columnar payloads', () => {
    const prompt = 'add tests';
    const legacy = JSON.stringify({
      warnings: [warning],
      records: [usage(0, { promptId: 'user:1' }), usage(1, { prompt: 'own', promptId: 'user:1' })],
      prompts: { 'user:1': prompt },
    });
    expect(decodePayload(legacy)).toEqual({
      records: [usage(0, { promptId: 'user:1', prompt }), usage(1, { prompt: 'own', promptId: 'user:1' })],
      warnings: [warning],
    });
  });

  test('rejects malformed payloads so the source is reparsed', () => {
    for (const raw of [
      'not json',
      'null',
      '[]',
      JSON.stringify({ records: [] }),
      JSON.stringify({ warnings: [], records: {} }),
      JSON.stringify({ warnings: [], records: [], prompts: { a: 1 } }),
      JSON.stringify({ format: 99, warnings: [], records: [] }),
      tamper((p) => (p['rows'] = [[1]])),
      tamper((p) => (p['rows'] = 'rows')),
      tamper((p) => (p['columns'] = ['date', 'date', 'timestamp', 'inputTokens'])),
      tamper((p) => (p['columns'] = [...(p['columns'] as string[]), 'unknown'])),
      tamper((p) => (p['keys'] = [...(p['keys'] as string[]), '__proto__'])),
      tamper((p) => ((p['shared'] as Record<string, unknown>)['model'] = { nested: true })),
      tamper((p) => delete (p['shared'] as Record<string, unknown>)['model']),
      tamper((p) => (p['shared'] = null)),
      tamper((p) => delete p['warnings']),
    ]) {
      expect(decodePayload(raw)).toBeNull();
    }
  });
});
