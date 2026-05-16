import { describe, expect, it } from 'bun:test';
import { parseReplayArgs } from './cli';
import { TokenleakError } from './errors';

describe('parseReplayArgs', () => {
  it('defaults date to today when no positional argument is given', () => {
    const { date, cliArgs } = parseReplayArgs([]);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cliArgs).toEqual({ dateExplicit: false });
  });

  it('flags explicit positional dates so the interactive view can pin to them', () => {
    const { cliArgs } = parseReplayArgs(['2026-04-22']);
    expect(cliArgs['dateExplicit']).toBe(true);
  });

  it('parses a YYYY-MM-DD positional date', () => {
    const { date } = parseReplayArgs(['2026-04-22']);
    expect(date).toBe('2026-04-22');
  });

  it('rejects malformed dates', () => {
    expect(() => parseReplayArgs(['not-a-date'])).toThrow(TokenleakError);
  });

  it('parses --interactive / -i / --open / --port together', () => {
    const { cliArgs } = parseReplayArgs([
      '2026-04-22',
      '--interactive',
      '--open',
      '--port',
      '4567',
    ]);
    expect(cliArgs['interactive']).toBe(true);
    expect(cliArgs['open']).toBe(true);
    expect(cliArgs['port']).toBe(4567);
  });

  it('accepts -i as the short alias for --interactive', () => {
    const { cliArgs } = parseReplayArgs(['-i']);
    expect(cliArgs['interactive']).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(() => parseReplayArgs(['--bogus'])).toThrow(TokenleakError);
  });

  describe('--record / --cast / --speed', () => {
    it('parses --record and --cast as the same flag', () => {
      expect(parseReplayArgs(['--record', 'day.cast']).cliArgs['record']).toBe('day.cast');
      expect(parseReplayArgs(['--cast', 'day.cast']).cliArgs['record']).toBe('day.cast');
    });

    it('--record requires an output path', () => {
      expect(() => parseReplayArgs(['--record'])).toThrow(TokenleakError);
    });

    it('parses --speed as a positive number', () => {
      expect(parseReplayArgs(['--speed', '600']).cliArgs['speed']).toBe(600);
      expect(parseReplayArgs(['--speed', '0.5']).cliArgs['speed']).toBe(0.5);
    });

    it('rejects non-positive or out-of-range speeds', () => {
      expect(() => parseReplayArgs(['--speed', '0'])).toThrow(TokenleakError);
      expect(() => parseReplayArgs(['--speed', '-1'])).toThrow(TokenleakError);
      expect(() => parseReplayArgs(['--speed', 'abc'])).toThrow(TokenleakError);
      expect(() => parseReplayArgs(['--speed', '20000'])).toThrow(TokenleakError);
    });
  });

  describe('--port validation', () => {
    it('rejects non-numeric values instead of silently defaulting', () => {
      expect(() => parseReplayArgs(['--port', 'abc'])).toThrow(TokenleakError);
    });

    it('rejects fractional values', () => {
      expect(() => parseReplayArgs(['--port', '3567.5'])).toThrow(TokenleakError);
    });

    it('rejects negative values', () => {
      expect(() => parseReplayArgs(['--port', '-1'])).toThrow(TokenleakError);
    });

    it('rejects values above the max port number', () => {
      expect(() => parseReplayArgs(['--port', '65536'])).toThrow(TokenleakError);
    });

    it('accepts the boundary values 0 and 65535', () => {
      expect(parseReplayArgs(['--port', '0']).cliArgs['port']).toBe(0);
      expect(parseReplayArgs(['--port', '65535']).cliArgs['port']).toBe(65_535);
    });

    it('requires a value', () => {
      expect(() => parseReplayArgs(['--port'])).toThrow(TokenleakError);
    });
  });
});
