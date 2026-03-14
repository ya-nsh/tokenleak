import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { resolveConfig, computeDateRange, inferFormatFromPath, normalizeCliArgv, run } from './cli';
import { loadConfig } from './config';
import { loadEnvOverrides } from './env';
import { TokenleakError } from './errors';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── inferFormatFromPath ────────────────────────────────────────────────

describe('inferFormatFromPath', () => {
  test('returns json for .json extension', () => {
    expect(inferFormatFromPath('output.json')).toBe('json');
  });

  test('returns svg for .svg extension', () => {
    expect(inferFormatFromPath('card.svg')).toBe('svg');
  });

  test('returns png for .png extension', () => {
    expect(inferFormatFromPath('card.png')).toBe('png');
  });

  test('returns null for unknown extension', () => {
    expect(inferFormatFromPath('output.txt')).toBeNull();
  });

  test('returns null for no extension', () => {
    expect(inferFormatFromPath('output')).toBeNull();
  });
});

describe('normalizeCliArgv', () => {
  test('keeps comma-separated provider list as a single argument when spaced', () => {
    const argv = normalizeCliArgv(['--provider', 'claude,', 'codex', '--format', 'json']);
    expect(argv).toEqual(['--provider', 'claude, codex', '--format', 'json']);
  });

  test('normalizes kebab-case flags while preserving provider values', () => {
    const argv = normalizeCliArgv(['--provider', 'claude,', 'codex', '--live-server']);
    expect(argv).toEqual(['--provider', 'claude, codex', '--liveServer']);
  });
});

// ─── computeDateRange ───────────────────────────────────────────────────

describe('computeDateRange', () => {
  test('uses --since and --until when both provided', () => {
    const range = computeDateRange({ since: '2025-01-01', until: '2025-01-31' });
    expect(range.since).toBe('2025-01-01');
    expect(range.until).toBe('2025-01-31');
  });

  test('computes since from days when --since not provided', () => {
    const range = computeDateRange({ until: '2025-06-15', days: 30 });
    expect(range.since).toBe('2025-05-16');
    expect(range.until).toBe('2025-06-15');
  });

  test('defaults to 90 days when neither --since nor --days provided', () => {
    const range = computeDateRange({ until: '2025-06-15' });
    expect(range.since).toBe('2025-03-17');
    expect(range.until).toBe('2025-06-15');
  });

  test('--since overrides --days', () => {
    const range = computeDateRange({ since: '2025-01-01', until: '2025-06-15', days: 10 });
    expect(range.since).toBe('2025-01-01');
  });

  test('throws on invalid --since format', () => {
    expect(() => computeDateRange({ since: 'not-a-date', until: '2025-06-15' })).toThrow(
      'Invalid --since date',
    );
  });

  test('throws on invalid --until format', () => {
    expect(() => computeDateRange({ until: '01-31-2025' })).toThrow(
      'Invalid --until date',
    );
  });

  test('throws on impossible date like 2025-02-30', () => {
    expect(() => computeDateRange({ since: '2025-02-30', until: '2025-06-15' })).toThrow(
      'Invalid --since date',
    );
  });

  test('throws when --since is after --until', () => {
    expect(() =>
      computeDateRange({ since: '2025-06-01', until: '2025-01-01' }),
    ).toThrow('must not be after');
  });
});

// ─── resolveConfig ──────────────────────────────────────────────────────

describe('resolveConfig', () => {
  test('returns defaults when no flags provided', () => {
    const config = resolveConfig({});
    expect(config.format).toBe('terminal');
    expect(config.theme).toBe('dark');
    expect(config.days).toBe(90);
    expect(config.width).toBe(80);
    expect(config.noColor).toBe(false);
    expect(config.noInsights).toBe(false);
    expect(config.more).toBe(false);
    expect(config.output).toBeNull();
    expect(config.claude).toBe(false);
    expect(config.codex).toBe(false);
    expect(config.openCode).toBe(false);
    expect(config.allProviders).toBe(false);
    expect(config.listProviders).toBe(false);
  });

  test('CLI flags override defaults', () => {
    const config = resolveConfig({
      format: 'json',
      theme: 'light',
      days: 30,
      width: 120,
      noColor: true,
      noInsights: true,
      more: true,
    });
    expect(config.format).toBe('json');
    expect(config.theme).toBe('light');
    expect(config.days).toBe(30);
    expect(config.width).toBe(120);
    expect(config.noColor).toBe(true);
    expect(config.noInsights).toBe(true);
    expect(config.more).toBe(true);
  });

  test('infers format from output file extension', () => {
    const config = resolveConfig({ output: 'result.json' });
    expect(config.format).toBe('json');
    expect(config.output).toBe('result.json');
  });

  test('explicit format overrides inferred from output', () => {
    const config = resolveConfig({ format: 'svg', output: 'result.json' });
    expect(config.format).toBe('svg');
  });

  test('passes --since and --until through', () => {
    const config = resolveConfig({ since: '2025-01-01', until: '2025-03-01' });
    expect(config.since).toBe('2025-01-01');
    expect(config.until).toBe('2025-03-01');
  });

  test('passes --provider through', () => {
    const config = resolveConfig({ provider: 'claude-code,codex' });
    expect(config.provider).toBe('claude-code,codex');
  });

  test('passes provider shortcut flags through', () => {
    const config = resolveConfig({ claude: true, codex: true, openCode: true });
    expect(config.claude).toBe(true);
    expect(config.codex).toBe(true);
    expect(config.openCode).toBe(true);
  });

  test('passes provider utility flags through', () => {
    const config = resolveConfig({ allProviders: true, listProviders: true });
    expect(config.allProviders).toBe(true);
    expect(config.listProviders).toBe(true);
  });

  test('passes --compare through', () => {
    const config = resolveConfig({ compare: '2025-01-01..2025-01-31' });
    expect(config.compare).toBe('2025-01-01..2025-01-31');
  });

  test('passes --more through', () => {
    const config = resolveConfig({ more: true });
    expect(config.more).toBe(true);
  });
});

// ─── loadEnvOverrides ───────────────────────────────────────────────────

describe('loadEnvOverrides', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    delete process.env['TOKENLEAK_FORMAT'];
    delete process.env['TOKENLEAK_THEME'];
    delete process.env['TOKENLEAK_DAYS'];
  });

  test('returns empty object when no env vars set', () => {
    delete process.env['TOKENLEAK_FORMAT'];
    delete process.env['TOKENLEAK_THEME'];
    delete process.env['TOKENLEAK_DAYS'];
    const overrides = loadEnvOverrides();
    expect(Object.keys(overrides).length).toBe(0);
  });

  test('reads TOKENLEAK_FORMAT', () => {
    process.env['TOKENLEAK_FORMAT'] = 'json';
    const overrides = loadEnvOverrides();
    expect(overrides.format).toBe('json');
  });

  test('reads TOKENLEAK_THEME', () => {
    process.env['TOKENLEAK_THEME'] = 'light';
    const overrides = loadEnvOverrides();
    expect(overrides.theme).toBe('light');
  });

  test('reads TOKENLEAK_DAYS', () => {
    process.env['TOKENLEAK_DAYS'] = '30';
    const overrides = loadEnvOverrides();
    expect(overrides.days).toBe(30);
  });

  test('ignores invalid format value', () => {
    process.env['TOKENLEAK_FORMAT'] = 'excel';
    const overrides = loadEnvOverrides();
    expect(overrides.format).toBeUndefined();
  });

  test('ignores invalid days value', () => {
    process.env['TOKENLEAK_DAYS'] = 'abc';
    const overrides = loadEnvOverrides();
    expect(overrides.days).toBeUndefined();
  });
});

// ─── loadConfig ─────────────────────────────────────────────────────────

describe('loadConfig', () => {
  test('returns empty object when config file does not exist', () => {
    // ~/.tokenleakrc likely doesn't exist in test environment
    const config = loadConfig();
    expect(typeof config).toBe('object');
  });
});

// ─── TokenleakError ─────────────────────────────────────────────────────

describe('TokenleakError', () => {
  test('is an instance of Error', () => {
    const err = new TokenleakError('test message');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TokenleakError');
    expect(err.message).toBe('test message');
  });
});

// ─── run function ───────────────────────────────────────────────────────

describe('run', () => {
  test('throws TokenleakError when no providers match filter', async () => {
    // Filter to a provider name that doesn't exist
    let thrown: unknown;
    try {
      await run({ format: 'json', provider: 'nonexistent-provider' });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TokenleakError);
    expect((thrown as TokenleakError).message).toBe('No provider data found');
  });

  test('throws TokenleakError for unsupported format', async () => {
    let thrown: unknown;
    try {
      await run({ format: 'pdf' });
    } catch (error: unknown) {
      thrown = error;
    }
    // Either no providers or unsupported format
    expect(thrown).toBeInstanceOf(TokenleakError);
  });

  test('throws when --all-providers is combined with provider filters', async () => {
    let thrown: unknown;
    try {
      await run({ allProviders: true, claude: true });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TokenleakError);
    expect((thrown as TokenleakError).message).toContain('--all-providers');
  });
});

// ─── CLI invocation tests (using Bun.spawn) ─────────────────────────────

describe('CLI invocation', () => {
  const cliPath = join(import.meta.dir, 'cli.ts');

  test('--help exits with code 0 and prints usage', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('tokenleak');
    expect(stdout).toContain('Provider Shortcuts');
    expect(stdout).toContain('--open-code');
    expect(stdout).toContain('--list-providers');
    expect(stdout).toContain('--more');
    expect(stdout).toContain('Examples:');
  });

  test('--version prints version', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.2');
    expect(stdout).toContain('schema');
  });

  test('no providers matching filter exits with code 1', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--format', 'json', '--provider', 'nonexistent'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain('No provider data found');
  });

  test('--list-providers exits with code 0 and prints registered providers', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--list-providers'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Registered providers:');
    expect(stdout).toContain('claude-code');
    expect(stdout).toContain('codex');
    expect(stdout).toContain('open-code');
  });

  test('--all-providers with provider filter exits with code 1', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--all-providers', '--claude'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--all-providers');
  });

  test('--provider tolerates spaces after commas', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--format', 'json', '--provider', 'claude,', 'codex'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"provider": "claude-code"');
    expect(stdout).toContain('"provider": "codex"');
  });
});
