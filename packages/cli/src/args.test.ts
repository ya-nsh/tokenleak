import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Mock } from 'bun:test';
import { infoFlagsFromArgv, printInfoFlag } from './args';

describe('infoFlagsFromArgv', () => {
  test('detects long and short help and version flags', () => {
    expect(infoFlagsFromArgv(['--help'])).toEqual({ help: true, version: false });
    expect(infoFlagsFromArgv(['-h'])).toEqual({ help: true, version: false });
    expect(infoFlagsFromArgv(['--days', '7', '--version'])).toEqual({ help: false, version: true });
    expect(infoFlagsFromArgv(['-v'])).toEqual({ help: false, version: true });
  });

  test('returns neither flag for empty argv', () => {
    expect(infoFlagsFromArgv([])).toEqual({ help: false, version: false });
  });
});

describe('printInfoFlag', () => {
  let written = '';
  let spy: Mock<typeof process.stdout.write>;

  beforeEach(() => {
    written = '';
    spy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  test('prints help and stops the command', () => {
    expect(printInfoFlag({ help: true }, () => 'HELP\n')).toBe(true);
    expect(written).toBe('HELP\n');
  });

  test('prints the version when only --version is set', () => {
    expect(printInfoFlag({ version: true }, () => 'HELP\n')).toBe(true);
    expect(written).toMatch(/^tokenleak .+\nschema .+\n$/);
  });

  test('help wins when both flags are set', () => {
    expect(printInfoFlag({ help: true, version: true }, () => 'HELP\n')).toBe(true);
    expect(written).toBe('HELP\n');
  });

  test('lets the command run when neither flag is set', () => {
    expect(printInfoFlag({}, () => 'HELP\n')).toBe(false);
    expect(written).toBe('');
  });
});
