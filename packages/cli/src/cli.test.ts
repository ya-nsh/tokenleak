import { describe, test, expect, afterEach } from 'bun:test';
import { defaultTerminalWidth, shouldUseColor } from './output-mode';
import { normalizeCliArgv } from './args';
import {
  resolveFocusConfig,
  runFocus,
  renderFocusReport,
  colorScore,
  colorDuration,
  colorDensity,
  colorProvider,
  colorStreak,
} from './commands/focus';
import { run } from './commands/report';
import { computeDateRange } from './date-range';
import { selectAvailableProviders } from './providers';
import { resolveConfig, inferFormatFromPath } from './report-options';
import { loadConfig } from './config';
import { loadEnvOverrides } from './env';
import { TokenleakError } from './errors';
import { shouldStartTui } from './tui-launch';
import {
  readFileSync,
  existsSync,
  cpSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';

const REGISTRY_FIXTURES_DIR = join(import.meta.dir, '..', '..', 'registry', 'src', '__fixtures__');

function createProviderFixtureEnv(): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'tokenleak-cli-fixtures-'));
  const claudeConfigDir = join(fixtureRoot, 'claude-config');
  const codexHome = join(fixtureRoot, 'codex-home');
  const cursorRoot = join(fixtureRoot, 'cursor-root');
  const piAgentDir = join(fixtureRoot, 'pi-agent');

  cpSync(join(REGISTRY_FIXTURES_DIR, 'claude-code'), join(claudeConfigDir, 'projects'), {
    recursive: true,
  });
  cpSync(join(REGISTRY_FIXTURES_DIR, 'codex', 'sessions'), join(codexHome, 'sessions'), {
    recursive: true,
  });
  cpSync(join(REGISTRY_FIXTURES_DIR, 'cursor-cache'), join(cursorRoot, 'cursor-cache'), {
    recursive: true,
  });
  cpSync(join(REGISTRY_FIXTURES_DIR, 'pi', 'agent'), piAgentDir, { recursive: true });

  return {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      CODEX_HOME: codexHome,
      TOKENLEAK_CURSOR_DIR: cursorRoot,
      PI_CODING_AGENT_DIR: piAgentDir,
    },
    cleanup: () => rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

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

function providerSelection(names: string[]): Parameters<typeof selectAvailableProviders>[0] {
  return {
    provider: names.length > 0 ? names.join(',') : undefined,
    claude: false,
    codex: false,
    cursor: false,
    pi: false,
    openCode: false,
    allProviders: false,
  };
}

describe('shouldStartTui', () => {
  test('starts only for bare tokenleak in a TTY', () => {
    expect(shouldStartTui([], true, true)).toBe(true);
    expect(shouldStartTui(['--help'], true, true)).toBe(false);
    expect(shouldStartTui([], false, true)).toBe(false);
    expect(shouldStartTui([], true, false)).toBe(false);
  });
});

describe('computeDateRange', () => {
  test('uses --since and --until when both provided', () => {
    const range = computeDateRange({ since: '2025-01-01', until: '2025-01-31' });
    expect(range.since).toBe('2025-01-01');
    expect(range.until).toBe('2025-01-31');
  });

  test('computes since from days when --since not provided', () => {
    const range = computeDateRange({ until: '2025-06-15', days: 30 });
    expect(range.since).toBe('2025-05-17');
    expect(range.until).toBe('2025-06-15');
  });

  test('defaults to 90 days when neither --since nor --days provided', () => {
    const range = computeDateRange({ until: '2025-06-15' });
    expect(range.since).toBe('2025-03-18');
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
    expect(() => computeDateRange({ until: '01-31-2025' })).toThrow('Invalid --until date');
  });

  test('throws on impossible date like 2025-02-30', () => {
    expect(() => computeDateRange({ since: '2025-02-30', until: '2025-06-15' })).toThrow(
      'Invalid --since date',
    );
  });

  test('throws when --since is after --until', () => {
    expect(() => computeDateRange({ since: '2025-06-01', until: '2025-01-01' })).toThrow(
      'must not be after',
    );
  });
});

// ─── resolveConfig ──────────────────────────────────────────────────────

describe('resolveConfig', () => {
  test('returns defaults when no flags provided', () => {
    const config = resolveConfig({});
    expect(config.format).toBe('terminal');
    expect(config.theme).toBe('dark');
    expect(config.days).toBe(90);
    expect(config.width).toBe(defaultTerminalWidth());
    expect(config.noColor).toBe(!shouldUseColor());
    expect(config.noInsights).toBe(false);
    expect(config.more).toBe(false);
    expect(config.output).toBeNull();
    expect(config.claude).toBe(false);
    expect(config.codex).toBe(false);
    expect(config.cursor).toBe(false);
    expect(config.pi).toBe(false);
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
    const config = resolveConfig({
      claude: true,
      codex: true,
      cursor: true,
      pi: true,
      openCode: true,
    });
    expect(config.claude).toBe(true);
    expect(config.codex).toBe(true);
    expect(config.cursor).toBe(true);
    expect(config.pi).toBe(true);
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

describe('resolveFocusConfig', () => {
  test('returns focus defaults when no flags provided', () => {
    const config = resolveFocusConfig({});
    expect(config.format).toBe('terminal');
    expect(config.days).toBe(90);
    expect(config.width).toBe(defaultTerminalWidth());
    expect(config.noColor).toBe(!shouldUseColor());
    expect(config.output).toBeNull();
    expect(config.listProviders).toBe(false);
  });

  test('infers json output from the file extension', () => {
    const config = resolveFocusConfig({ output: 'focus.json' });
    expect(config.format).toBe('json');
    expect(config.output).toBe('focus.json');
  });

  test('passes provider filters through', () => {
    const config = resolveFocusConfig({ provider: 'codex', pi: true, allProviders: false });
    expect(config.provider).toBe('codex');
    expect(config.pi).toBe(true);
    expect(config.allProviders).toBe(false);
  });

  test('rejects invalid focus formats at config resolution time', () => {
    expect(() => resolveFocusConfig({ format: 'png' })).toThrow(
      'Unsupported focus format: "png". Available: json, terminal',
    );
  });
});

// ─── loadEnvOverrides ───────────────────────────────────────────────────

describe('loadEnvOverrides', () => {
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

  test('throws a login hint when cursor is requested without auth or cache', async () => {
    const originalCursorDir = process.env['TOKENLEAK_CURSOR_DIR'];
    const cursorRoot = mkdtempSync(join(tmpdir(), 'tokenleak-empty-cursor-'));
    let thrown: unknown;
    try {
      process.env['TOKENLEAK_CURSOR_DIR'] = cursorRoot;
      await run({ format: 'json', provider: 'cursor' });
    } catch (error: unknown) {
      thrown = error;
    } finally {
      if (originalCursorDir === undefined) {
        delete process.env['TOKENLEAK_CURSOR_DIR'];
      } else {
        process.env['TOKENLEAK_CURSOR_DIR'] = originalCursorDir;
      }
      rmSync(cursorRoot, { recursive: true, force: true });
    }
    expect(thrown).toBeInstanceOf(TokenleakError);
    expect((thrown as TokenleakError).message).toBe(
      'Cursor is selected but not authenticated. Run `tokenleak cursor login` first.',
    );
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

  test('selectAvailableProviders loads cursor from selected provider list', async () => {
    const { env, cleanup } = createProviderFixtureEnv();
    const previousEnv = process.env;

    try {
      process.env = env;
      const providers = await selectAvailableProviders(providerSelection(['cursor']));
      expect(providers).toHaveLength(1);
      expect(providers[0]?.name).toBe('cursor');
    } finally {
      process.env = previousEnv;
      cleanup();
    }
  });

  test('selectAvailableProviders keeps synthetic selection scoped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenleak-synthetic-cli-'));
    const dbPath = join(root, 'sqlite.db');
    const db = new Database(dbPath);
    db.run('CREATE TABLE messages (id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, timestamp INTEGER, session_id TEXT)');
    db.run("INSERT INTO messages VALUES ('m1', 'hf:org/model', 1, 1, 1770724800000, 's1')");
    db.close();
    const previousEnv = process.env;

    try {
      process.env = { ...process.env, TOKENLEAK_SYNTHETIC_DIR: dbPath };
      const providers = await selectAvailableProviders(providerSelection(['synthetic']));
      expect(providers.map((provider) => provider.name)).toEqual(['synthetic']);
    } finally {
      process.env = previousEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('selectAvailableProviders excludes synthetic from default provider scans', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenleak-synthetic-default-cli-'));
    const dbPath = join(root, 'sqlite.db');
    const db = new Database(dbPath);
    db.run('CREATE TABLE messages (id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, timestamp INTEGER, session_id TEXT)');
    db.run("INSERT INTO messages VALUES ('m1', 'hf:org/model', 1, 1, 1770724800000, 's1')");
    db.close();
    const previousEnv = process.env;

    try {
      process.env = { ...process.env, TOKENLEAK_SYNTHETIC_DIR: dbPath };
      const providers = await selectAvailableProviders(providerSelection([]));
      expect(providers.map((provider) => provider.name)).not.toContain('synthetic');
    } finally {
      process.env = previousEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('runFocus', () => {
  test('throws when the focus format is unsupported', async () => {
    let thrown: unknown;
    try {
      await runFocus({ format: 'png' });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TokenleakError);
    expect((thrown as TokenleakError).message).toContain('Unsupported focus format');
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
    expect(stdout).toContain('--pi');
    expect(stdout).toContain('--open-code');
    expect(stdout).toContain('--list-providers');
    expect(stdout).toContain('--more');
    expect(stdout).toContain('tokenleak explain <date>');
    expect(stdout).toContain('focus');
    expect(stdout).toContain('tokenleak simulate-routing');
    expect(stdout).toContain('tokenleak waste');
    expect(stdout).toContain('tokenleak behavior-diff');
    expect(stdout).toContain('opens the TUI dashboard');
    expect(stdout).not.toContain('--legacy');
    expect(stdout).toContain('Examples:');
  });

  test('focus --help exits with code 0 and prints focus usage', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'focus', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain('tokenleak focus');
    expect(stdout).toContain('deep-work score');
    expect(stdout).toContain('--format <format>');
  });

  test('commons --help exits with code 0 and lists prompt export', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'commons', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain('tokenleak commons');
    expect(stdout).toContain('commons prompt');
    expect(stdout).toContain('--clipboard');
  });

  test('commons prompt writes an LLM-ready markdown prompt', async () => {
    const { env, cleanup } = createProviderFixtureEnv();
    const outputDir = mkdtempSync(join(tmpdir(), 'tokenleak-commons-prompt-'));
    const outputPath = join(outputDir, 'prompt.md');

    try {
      const proc = Bun.spawn(
        ['bun', cliPath, 'commons', 'prompt', '--provider', 'pi', '--output', outputPath],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env,
        },
      );
      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode, stderr).toBe(0);
      expect(existsSync(outputPath)).toBe(true);
      const rendered = readFileSync(outputPath, 'utf-8');
      expect(rendered).toContain('# Tokenleak LLM Analysis Prompt');
      expect(rendered).toContain('## Privacy Guarantees');
      expect(rendered).toContain('"containsPrompts": false');
    } finally {
      cleanup();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test('commons export rejects invalid day counts with a clear error', async () => {
    const proc = Bun.spawn(
      ['bun', cliPath, 'commons', 'export', '--days', 'nope', '--provider', 'pi'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--days must be a positive number');
  });

  test('waste --help exits with code 0 and prints waste usage', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'waste', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain('tokenleak waste');
    expect(stdout).toContain('Savings findings with evidence');
  });

  test('waste emits a JSON agent waste report', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const waste = Bun.spawn(['bun', cliPath, 'waste', '--format', 'json', '--provider', 'pi'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const wasteExit = await waste.exited;
      const wasteStdout = await new Response(waste.stdout).text();
      expect(wasteExit).toBe(0);
      expect(JSON.parse(wasteStdout).summary).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test('waste --severity filters the savings report recommendations', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const waste = Bun.spawn(
        ['bun', cliPath, 'waste', '--format', 'json', '--provider', 'pi', '--since', '2020-01-01', '--severity', 'low'],
        { stdout: 'pipe', stderr: 'pipe', env },
      );
      expect(await waste.exited).toBe(0);
      const report = JSON.parse(await new Response(waste.stdout).text());
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.recommendations.every((r: { severity: string }) => r.severity === 'low')).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('--advisor --format json emits the same savings report as waste', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const run = async (args: string[]) => {
        const proc = Bun.spawn(['bun', cliPath, ...args, '--format', 'json', '--provider', 'pi', '--since', '2020-01-01'], {
          stdout: 'pipe',
          stderr: 'pipe',
          env,
        });
        expect(await proc.exited).toBe(0);
        return JSON.parse(await new Response(proc.stdout).text());
      };
      const [advisor, waste] = await Promise.all([run(['--advisor']), run(['waste'])]);
      expect(advisor.summary.analyzedEvents).toBe(waste.summary.analyzedEvents);
      expect(advisor.recommendations.map((r: { title: string }) => r.title)).toEqual(
        waste.recommendations.map((r: { title: string }) => r.title),
      );
      expect(typeof advisor.summary.currentMonthlyCost).toBe('number');
    } finally {
      cleanup();
    }
  });

  test('simulate-routing emits a JSON routing report', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const simulate = Bun.spawn(['bun', cliPath, 'simulate-routing', '--format', 'json', '--provider', 'pi'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const simulateExit = await simulate.exited;
      const simulateStdout = await new Response(simulate.stdout).text();
      expect(simulateExit).toBe(0);
      expect(JSON.parse(simulateStdout).strategy).toBe('conservative');
    } finally {
      cleanup();
    }
  });

  test('behavior-diff emits a JSON behavior diff report', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const diff = Bun.spawn(
        ['bun', cliPath, 'behavior-diff', '--format', 'json', '--provider', 'pi,claude-code'],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env,
        },
      );
      const diffExit = await diff.exited;
      const diffStdout = await new Response(diff.stdout).text();
      expect(diffExit).toBe(0);
      expect(JSON.parse(diffStdout).takeaways).toBeArray();
    } finally {
      cleanup();
    }
  });

  test('--version prints version', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('2.3.0');
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
    expect(stdout).toContain('cursor');
    expect(stdout).toContain('gemini');
    expect(stdout).toContain('copilot');
    expect(stdout).toContain('amp');
    expect(stdout).toContain('codebuff');
    expect(stdout).toContain('droid');
    expect(stdout).toContain('qwen');
    expect(stdout).toContain('roo-code');
    expect(stdout).toContain('kilo-code');
    expect(stdout).toContain('kimi');
    expect(stdout).toContain('kilo');
    expect(stdout).toContain('mux');
    expect(stdout).toContain('crush');
    expect(stdout).toContain('openclaw');
    expect(stdout).toContain('hermes');
    expect(stdout).toContain('goose');
    expect(stdout).toContain('antigravity');
    expect(stdout).toContain('zed');
    expect(stdout).toContain('kiro');
    expect(stdout).toContain('trae');
    expect(stdout).toContain('synthetic');
    expect(stdout).toContain('pi');
    expect(stdout).toContain('open-code');
    expect(stdout).toContain('github-copilot');
    expect(stdout).toContain('sourcegraph-amp');
    expect(stdout).toContain('manicode');
    expect(stdout).toContain('kilo-cli');
    expect(stdout).toContain('octofriend');
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
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(
        ['bun', cliPath, '--format', 'json', '--provider', 'claude,', 'codex'],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env,
        },
      );
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"provider": "claude-code"');
      expect(stdout).toContain('"provider": "codex"');
    } finally {
      cleanup();
    }
  });

  test('--provider pi loads pi-mono local session data when configured', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(['bun', cliPath, '--format', 'json', '--provider', 'pi'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"provider": "pi"');
      expect(stdout).toContain('"displayName": "Pi"');
    } finally {
      cleanup();
    }
  });

  test('--provider cursor loads cached cursor data when configured', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(['bun', cliPath, '--format', 'json', '--provider', 'cursor'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"provider": "cursor"');
      expect(stdout).toContain('"displayName": "Cursor"');
    } finally {
      cleanup();
    }
  });

  test('--format terminal --compare auto renders a terminal compare dashboard', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(
        ['bun', cliPath, '--format', 'terminal', '--compare', 'auto', '--provider', 'pi'],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env,
        },
      );
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Tokenleak');
      expect(stdout).toContain('Compare');
      expect(stdout).not.toContain('"periodA"');
    } finally {
      cleanup();
    }
  });

  test('focus --format json emits a ranked focus report', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(['bun', cliPath, 'focus', '--format', 'json', '--provider', 'pi',
        '--since', '2026-03-10', '--until', '2026-03-11'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const parsed = JSON.parse(stdout);

      expect(exitCode).toBe(0);
      expect(parsed.method).toContain('Deep-work score');
      expect(Array.isArray(parsed.entries)).toBe(true);
      expect(parsed.entries.length).toBeGreaterThan(0);
      expect(parsed.entries[0]).toHaveProperty('provider', 'pi');
      expect(parsed.entries[0]).toHaveProperty('score');
    } finally {
      cleanup();
    }
  });

  test('focus terminal output includes session ranking details', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(['bun', cliPath, 'focus', '--provider', 'pi',
        '--since', '2026-03-10', '--until', '2026-03-11'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Tokenleak Focus');
      expect(stdout).toContain('deep-work score');
      expect(stdout).toContain('Score');
      expect(stdout).toContain('Provider');
    } finally {
      cleanup();
    }
  });

  test('explain renders a terminal report for a target day', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(['bun', cliPath, 'explain', '2026-03-11', '--provider', 'pi'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Explain 2026-03-11');
      expect(stdout).toContain('Providers');
      expect(stdout).toContain('Models');
      expect(stdout).toContain('Anomalies');
    } finally {
      cleanup();
    }
  });

  test('explain renders JSON when requested', async () => {
    const { env, cleanup } = createProviderFixtureEnv();

    try {
      const proc = Bun.spawn(
        ['bun', cliPath, 'explain', '2026-03-11', '--format', 'json', '--provider', 'pi'],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env,
        },
      );
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"date": "2026-03-11"');
      expect(stdout).toContain('"headline"');
      expect(stdout).toContain('"topProviders"');
      expect(stdout).toContain('"anomalies"');
    } finally {
      cleanup();
    }
  });

  test('explain rejects unsupported formats', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'explain', '2026-03-11', '--format', 'svg'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('only supports --format terminal or --format json');
  });

  test('explain rejects invalid date input', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'explain', 'not-a-date'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('"not-a-date" is not in YYYY-MM-DD format');
  });

  test('unknown flags exit 1, suggest the closest flag, and print usage', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--day', '30'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown flag "--day"');
    expect(stderr).toContain('Did you mean "--days"?');
    expect(stderr).toContain('Usage: tokenleak [flags]');
  });

  test('subcommands built on citty reject unknown flags too', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'focus', '--bogus'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown flag "--bogus" for `tokenleak focus`');
  });

  test('statusline --help documents the Claude Code status line setup', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'statusline', '--help'], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(stdout).toContain('"statusLine"');
    expect(stdout).toContain('tokenleak statusline');
  });

  test('statusline rejects unknown flags', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'statusline', '--colour'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain('Unknown flag "--colour"');
  });

  test('a mistyped subcommand fails instead of rendering the dashboard', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'explian'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain('Did you mean `tokenleak explain`?');
  });

  test('--verbose is accepted by every command', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'pricing', '--help', '--verbose'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await proc.exited).toBe(0);
  });
});

describe('renderFocusReport', () => {
  const mockFocusReport = {
    method: 'event-based scoring',
    entries: [
      {
        sessionId: 'sess-1',
        label: 'Build UI components',
        provider: 'claude-code',
        projectId: null,
        repoRoot: null,
        start: '2026-03-01T08:00:00Z',
        end: '2026-03-01T10:15:00Z',
        durationMs: 8_100_000,
        tokensPerHour: 45230,
        totalTokens: 102000,
        cost: 3.5,
        streak: 3,
        score: 8.5,
        scoreBreakdown: { duration: 0.45, density: 0.3, streak: 0.25 },
        rationale: ['dur 45%', 'den 30%', 'stk 25%'],
      },
      {
        sessionId: 'sess-2',
        label: 'API work',
        provider: 'codex',
        projectId: null,
        repoRoot: null,
        start: '2026-03-02T14:00:00Z',
        end: '2026-03-02T15:30:00Z',
        durationMs: 5_400_000,
        tokensPerHour: 32100,
        totalTokens: 48150,
        cost: 1.2,
        streak: 2,
        score: 7.2,
        scoreBreakdown: { duration: 0.4, density: 0.35, streak: 0.25 },
        rationale: ['dur 40%', 'den 35%', 'stk 25%'],
      },
    ],
  };

  test('output contains box drawing characters', () => {
    const output = renderFocusReport(mockFocusReport, 80, false);
    expect(output).toContain('\u250C'); // ┌
    expect(output).toContain('\u2500'); // ─
    expect(output).toContain('\u2502'); // │
    expect(output).toContain('\u2514'); // └
    expect(output).toContain('\u252C'); // ┬
    expect(output).toContain('\u2534'); // ┴
    expect(output).toContain('\u253C'); // ┼
    expect(output).toContain('\u251C'); // ├
    expect(output).toContain('\u2524'); // ┤
    expect(output).toContain('\u2510'); // ┐
    expect(output).toContain('\u2518'); // ┘
  });

  test('no line exceeds width parameter (noColor)', () => {
    const width = 80;
    const output = renderFocusReport(mockFocusReport, width, true);
    const lines = output.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(width);
    }
  });

  test('no line exceeds width parameter at width 100 (noColor)', () => {
    const width = 100;
    const output = renderFocusReport(mockFocusReport, width, true);
    const lines = output.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(width);
    }
  });

  test('empty report shows no session data message', () => {
    const emptyReport = { method: 'event-based scoring', entries: [] };
    const output = renderFocusReport(emptyReport, 80, false);
    expect(output).toContain('No session data available.');
    expect(output).toContain('0 sessions ranked by deep-work score.');
    // Should not contain box drawing for empty report
    expect(output).not.toContain('\u250C');
  });

  test('each entry is exactly one row', () => {
    const output = renderFocusReport(mockFocusReport, 100, true);
    const lines = output.split('\n');
    // Each entry should appear as a single line containing both score and provider
    for (const entry of mockFocusReport.entries) {
      const dataLines = lines.filter(
        (l) => l.includes(entry.score.toFixed(1)) && l.includes(entry.provider),
      );
      expect(dataLines.length).toBe(1);
    }
  });

  test('label column shrinks when terminal is narrow', () => {
    const longLabelReport = {
      method: 'test',
      entries: [
        {
          ...mockFocusReport.entries[0]!,
          label:
            'A very long label that forces the table to be wider than a narrow terminal allows',
        },
      ],
    };
    const narrow = renderFocusReport(longLabelReport, 60, true);
    const wide = renderFocusReport(longLabelReport, 120, true);
    const narrowTopLine = narrow.split('\n').find((l) => l.startsWith('\u250C'))!;
    const wideTopLine = wide.split('\n').find((l) => l.startsWith('\u250C'))!;
    expect(wideTopLine.length).toBeGreaterThan(narrowTopLine.length);
  });

  test('header row contains column names', () => {
    const output = renderFocusReport(mockFocusReport, 80, false);
    expect(output).toContain('Score');
    expect(output).toContain('Dur');
    expect(output).toContain('Density');
    expect(output).toContain('Stk');
    expect(output).toContain('Provider');
    expect(output).toContain('Label');
  });

  test('separator rows appear between entries but not after the last', () => {
    const output = renderFocusReport(mockFocusReport, 80, true);
    const lines = output.split('\n');
    // Count mid-separators — use noColor so startsWith/endsWith work
    const midSeparators = lines.filter((l) => l.startsWith('\u251C') && l.endsWith('\u2524'));
    // header separator + (entries - 1) between-entry separators = 1 + 1 = 2
    expect(midSeparators.length).toBe(2);
  });

  test('all table lines (borders + data) have identical visible width (noColor)', () => {
    const output = renderFocusReport(mockFocusReport, 90, true);
    const lines = output.split('\n');
    const tableLines = lines.filter(
      (l) =>
        l.includes('\u2502') ||
        l.includes('\u250C') ||
        l.includes('\u2514') ||
        l.includes('\u251C'),
    );
    expect(tableLines.length).toBeGreaterThan(0);
    const firstLen = tableLines[0]!.length;
    for (const line of tableLines) {
      expect(line.length).toBe(firstLen);
    }
  });

  test('long labels are truncated with ellipsis at narrow width', () => {
    const longLabelReport = {
      method: 'test',
      entries: [
        {
          ...mockFocusReport.entries[0]!,
          label:
            'This is a very long label that should definitely be truncated when the terminal is narrow',
        },
      ],
    };
    const output = renderFocusReport(longLabelReport, 70, true);
    expect(output).toContain('\u2026'); // … ellipsis
    const lines = output.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(70);
    }
  });

  // ─── 256-color tests ────────────────────────────────────────────────

  test('contains ANSI escape codes when noColor is false', () => {
    const output = renderFocusReport(mockFocusReport, 80, false);
    expect(/\x1b\[/.test(output)).toBe(true);
  });

  test('contains no ANSI escape codes when noColor is true', () => {
    const output = renderFocusReport(mockFocusReport, 80, true);
    expect(/\x1b\[/.test(output)).toBe(false);
  });

  test('score >= 8 uses green (color code 71)', () => {
    const text = colorScore(8.5, '8.5   ', false);
    expect(text).toContain('38;5;71m');
  });

  test('score >= 5 but < 8 uses amber (color code 179)', () => {
    const text = colorScore(5.5, '5.5   ', false);
    expect(text).toContain('38;5;179m');
  });

  test('score >= 3 but < 5 uses cyan (color code 73)', () => {
    const text = colorScore(3.5, '3.5   ', false);
    expect(text).toContain('38;5;73m');
  });

  test('score < 3 uses dim styling', () => {
    const text = colorScore(2.0, '2.0   ', false);
    expect(text).toContain('\x1b[2m');
  });

  test('duration > 1h uses bold white (code 255)', () => {
    const text = colorDuration(4_000_000, '1h06m ', false);
    expect(text).toContain('38;5;255m');
    expect(text).toContain('\x1b[1;');
  });

  test('duration <= 1h returns plain text', () => {
    const text = colorDuration(1_800_000, '30m   ', false);
    expect(text).toBe('30m   ');
  });

  test('density > 30k uses green (code 71)', () => {
    const text = colorDensity(35_000, '35,000/h    ', false);
    expect(text).toContain('38;5;71m');
  });

  test('density > 15k uses amber (code 179)', () => {
    const text = colorDensity(20_000, '20,000/h    ', false);
    expect(text).toContain('38;5;179m');
  });

  test('density <= 15k uses dim', () => {
    const text = colorDensity(10_000, '10,000/h    ', false);
    expect(text).toContain('\x1b[2m');
  });

  test('streak >= 3 uses orange (code 208)', () => {
    const text = colorStreak(5, '5d  ', false);
    expect(text).toContain('38;5;208m');
  });

  test('streak < 3 returns plain text', () => {
    const text = colorStreak(2, '2d  ', false);
    expect(text).toBe('2d  ');
  });

  test('known provider uses its color, unknown falls back to gray (246)', () => {
    const claude = colorProvider('claude-code', 'claude-code', false);
    expect(claude).toContain('38;5;179m');

    const unknown = colorProvider('unknown-tool', 'unknown-tool', false);
    expect(unknown).toContain('38;5;246m');
  });

  test('all color helpers return plain text when noColor is true', () => {
    expect(colorScore(9, 'hi', true)).toBe('hi');
    expect(colorDuration(5_000_000, 'hi', true)).toBe('hi');
    expect(colorDensity(50_000, 'hi', true)).toBe('hi');
    expect(colorStreak(5, 'hi', true)).toBe('hi');
    expect(colorProvider('claude-code', 'hi', true)).toBe('hi');
  });
});

