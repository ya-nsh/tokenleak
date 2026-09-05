import { expect, test } from 'bun:test';
import { parseCompareRange } from './compare';

test.each(['2026-02-30..2026-03-02', '2026-02-29..2026-03-02', '2026-13-01..2027-01-01', '2026-00-01..2026-01-01'])(
  'rejects impossible comparison dates: %s', (value) => { expect(parseCompareRange(value)).toBeNull(); },
);
test('accepts real leap days and ordinary ranges', () => {
  expect(parseCompareRange('2024-02-29..2024-03-01')).toEqual({ since: '2024-02-29', until: '2024-03-01' });
  expect(parseCompareRange('2026-03-12..2026-03-12')).not.toBeNull();
});
