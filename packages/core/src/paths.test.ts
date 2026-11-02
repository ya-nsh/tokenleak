import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getTokenleakCacheDir } from './paths';

const original = process.env['TOKENLEAK_CACHE_DIR'];

afterEach(() => {
  if (original === undefined) delete process.env['TOKENLEAK_CACHE_DIR'];
  else process.env['TOKENLEAK_CACHE_DIR'] = original;
});

describe('getTokenleakCacheDir', () => {
  test('honors TOKENLEAK_CACHE_DIR', () => {
    process.env['TOKENLEAK_CACHE_DIR'] = '/tmp/tokenleak-elsewhere';
    expect(getTokenleakCacheDir()).toBe('/tmp/tokenleak-elsewhere');
  });

  test('ignores a blank override', () => {
    process.env['TOKENLEAK_CACHE_DIR'] = '   ';
    expect(getTokenleakCacheDir()).toBe(join(homedir(), '.cache', 'tokenleak'));
  });

  test('defaults to ~/.cache/tokenleak', () => {
    delete process.env['TOKENLEAK_CACHE_DIR'];
    expect(getTokenleakCacheDir()).toBe(join(homedir(), '.cache', 'tokenleak'));
  });
});
