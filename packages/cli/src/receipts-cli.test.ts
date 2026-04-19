import { describe, expect, it } from 'bun:test';
import {
  parseReceiptsArgs,
  inferReceiptsFormat,
  validateReceiptsShareFlags,
} from './cli';
import { TokenleakError } from './errors';

describe('parseReceiptsArgs', () => {
  it('parses share flags and format/output pairs', () => {
    const parsed = parseReceiptsArgs([
      '--format', 'svg',
      '--output', 'receipt.svg',
      '--clipboard',
      '--open',
      '--upload', 'gist',
    ]);
    expect(parsed['format']).toBe('svg');
    expect(parsed['output']).toBe('receipt.svg');
    expect(parsed['clipboard']).toBe(true);
    expect(parsed['open']).toBe(true);
    expect(parsed['upload']).toBe('gist');
  });

  it('rejects --top values that are not positive integers', () => {
    expect(() => parseReceiptsArgs(['--top', '0'])).toThrow(TokenleakError);
    expect(() => parseReceiptsArgs(['--top', '-5'])).toThrow(TokenleakError);
    expect(() => parseReceiptsArgs(['--top', '2.5'])).toThrow(TokenleakError);
    expect(() => parseReceiptsArgs(['--top', 'abc'])).toThrow(TokenleakError);
  });

  it('accepts --top as a positive integer', () => {
    expect(parseReceiptsArgs(['--top', '5'])['top']).toBe(5);
  });

  it('requires a value for --upload and errors on missing arg', () => {
    expect(() => parseReceiptsArgs(['--upload'])).toThrow(TokenleakError);
  });

  it('rejects unknown receipts flags', () => {
    expect(() => parseReceiptsArgs(['--nonsense'])).toThrow(TokenleakError);
  });

  it('accepts short aliases for format/output/since/until/days/theme/provider', () => {
    const parsed = parseReceiptsArgs([
      '-f', 'json',
      '-o', 'out.json',
      '-s', '2026-04-01',
      '-u', '2026-04-30',
      '-d', '14',
      '-t', 'light',
      '-p', 'claude-code',
    ]);
    expect(parsed['format']).toBe('json');
    expect(parsed['output']).toBe('out.json');
    expect(parsed['since']).toBe('2026-04-01');
    expect(parsed['until']).toBe('2026-04-30');
    expect(parsed['days']).toBe(14);
    expect(parsed['theme']).toBe('light');
    expect(parsed['provider']).toBe('claude-code');
  });
});

describe('inferReceiptsFormat', () => {
  it('returns the explicit --format when provided', () => {
    expect(inferReceiptsFormat({ format: 'svg' })).toBe('svg');
    expect(inferReceiptsFormat({ format: 'png' })).toBe('png');
    expect(inferReceiptsFormat({ format: 'json' })).toBe('json');
    expect(inferReceiptsFormat({ format: 'terminal' })).toBe('terminal');
  });

  it('infers from the output extension case-insensitively', () => {
    expect(inferReceiptsFormat({ output: 'receipt.svg' })).toBe('svg');
    expect(inferReceiptsFormat({ output: 'receipt.PNG' })).toBe('png');
    expect(inferReceiptsFormat({ output: 'receipt.JSON' })).toBe('json');
  });

  it('falls back to terminal when no format hint is present', () => {
    expect(inferReceiptsFormat({})).toBe('terminal');
    expect(inferReceiptsFormat({ output: 'receipt.txt' })).toBe('terminal');
  });

  it('throws on an unknown --format value', () => {
    expect(() => inferReceiptsFormat({ format: 'wrapped' })).toThrow(TokenleakError);
    expect(() => inferReceiptsFormat({ format: 'pdf' })).toThrow(TokenleakError);
  });
});

describe('validateReceiptsShareFlags', () => {
  it('requires --output for --format png', () => {
    expect(() =>
      validateReceiptsShareFlags('png', { output: null, open: false }),
    ).toThrow(/--output .* png/);
  });

  it('accepts --format png when --output is provided', () => {
    expect(() =>
      validateReceiptsShareFlags('png', { output: '/tmp/r.png', open: false }),
    ).not.toThrow();
  });

  it('requires --output when --open is set', () => {
    expect(() =>
      validateReceiptsShareFlags('terminal', { output: null, open: true }),
    ).toThrow(/--open requires --output/);
  });

  it('rejects unknown upload targets', () => {
    expect(() =>
      validateReceiptsShareFlags('svg', { output: null, open: false, upload: 'pastebin' }),
    ).toThrow(/Unknown upload target/);
  });

  it('rejects --upload gist combined with --format png', () => {
    expect(() =>
      validateReceiptsShareFlags('png', { output: '/tmp/r.png', open: false, upload: 'gist' }),
    ).toThrow(/--upload gist does not support --format png/);
  });

  it('accepts --upload gist with svg, json, and terminal formats', () => {
    expect(() =>
      validateReceiptsShareFlags('svg', { output: null, open: false, upload: 'gist' }),
    ).not.toThrow();
    expect(() =>
      validateReceiptsShareFlags('json', { output: null, open: false, upload: 'gist' }),
    ).not.toThrow();
    expect(() =>
      validateReceiptsShareFlags('terminal', { output: null, open: false, upload: 'gist' }),
    ).not.toThrow();
  });
});
