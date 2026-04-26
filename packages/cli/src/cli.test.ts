import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  buildInteractiveSummary,
  resolveConfig,
  resolveFocusConfig,
  resolveTabbedDashboardProviderConfig,
  resolveTabbedDashboardProviders,
  computeDateRange,
  inferFormatFromPath,
  normalizeCliArgv,
  run,
  runFocus,
  renderFocusReport,
  colorScore,
  colorDuration,
  colorDensity,
  colorProvider,
  colorStreak,
} from './cli';
import { loadConfig } from './config';
import { loadEnvOverrides } from './env';
import { TokenleakError } from './errors';
import { buildCliArgTokens, buildCliPreview } from './flags';
import {
  INTERACTIVE_FLAG_LINES,
  shouldStartInteractiveCli,
  finalizeCliArgs,
  stripAnsi,
  visibleLength,
  padVisible,
  truncateVisible,
  clampScrollOffset,
  buildOutputSectionLines,
  buildLauncherBody,
  buildTabbedDashboardOptions,
  createMenuOptions,
  renderProgressBar,
} from './interactive';
import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  cpSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

describe('interactive launcher', () => {
  test('starts only for bare tokenleak in a TTY', () => {
    expect(shouldStartInteractiveCli([], true, true)).toBe(true);
    expect(shouldStartInteractiveCli(['--help'], true, true)).toBe(false);
    expect(shouldStartInteractiveCli([], false, true)).toBe(false);
    expect(shouldStartInteractiveCli([], true, false)).toBe(false);
  });

  test('--legacy flag routes to classic launcher (not TUI)', () => {
    // --legacy alone should still trigger interactive (after filtering)
    const legacyArgv = ['--legacy'];
    const filtered = legacyArgv.filter((a) => a !== '--legacy');
    expect(shouldStartInteractiveCli(filtered, true, true)).toBe(true);
    // --legacy with other flags should not trigger interactive
    expect(shouldStartInteractiveCli(['--legacy', '--help'], true, true)).toBe(false);
  });

  test('flag panel includes key interactive flags', () => {
    expect(INTERACTIVE_FLAG_LINES).toContain('    explain <date>       explain one day of usage');
    expect(INTERACTIVE_FLAG_LINES).toContain('    focus                rank deep-work sessions');
    expect(INTERACTIVE_FLAG_LINES).toContain('    --cursor            shortcut for Cursor');
    expect(INTERACTIVE_FLAG_LINES).toContain(
      '-f, --format <format>   terminal | png | svg | json | wrapped',
    );
    expect(INTERACTIVE_FLAG_LINES).toContain(
      '    --compare <range>   auto or YYYY-MM-DD..YYYY-MM-DD',
    );
    expect(INTERACTIVE_FLAG_LINES).toContain('-L, --live-server       local interactive dashboard');
  });

  test('buildTabbedDashboardOptions preserves dashboard scope inputs', () => {
    expect(
      buildTabbedDashboardOptions(
        { days: 7, until: '2026-03-14' },
        ['claude-code', 'codex'],
        120,
        true,
        true,
      ),
    ).toEqual({
      compare: 'auto',
      initialTimeRange: '7d',
      noColor: true,
      noInsights: true,
      providerNames: ['claude-code', 'codex'],
      until: '2026-03-14',
      width: 120,
    });
  });

  test('buildTabbedDashboardOptions maps custom ranges onto the nearest dashboard tab', () => {
    expect(
      buildTabbedDashboardOptions(
        { since: '2026-01-01', until: '2026-03-14' },
        [],
        null,
        false,
        false,
      ),
    ).toMatchObject({
      compare: 'auto',
      initialTimeRange: '90d',
      initialRange: {
        since: '2026-01-01',
        until: '2026-03-14',
      },
      noColor: false,
      noInsights: false,
      until: '2026-03-14',
    });
  });

  test('buildTabbedDashboardOptions validates custom dates before storing them', () => {
    expect(() =>
      buildTabbedDashboardOptions(
        { since: '2026-03-14', until: '2026-03-01' },
        [],
        null,
        false,
        false,
        null,
      ),
    ).toThrow('must not be after');

    expect(() =>
      buildTabbedDashboardOptions({ since: 'not-a-date' }, [], null, false, false, null),
    ).toThrow('Invalid --since date');
  });

  test('resolveTabbedDashboardProviderConfig preserves selected providers', () => {
    expect(resolveTabbedDashboardProviderConfig({ providerNames: ['cursor'] })).toEqual({
      provider: 'cursor',
      claude: false,
      codex: false,
      cursor: false,
      pi: false,
      openCode: false,
      allProviders: false,
    });
  });
});

describe('consolidated menu', () => {
  test('has unique shortcuts covering digits 1-0 and Receipts', () => {
    const options = createMenuOptions();
    expect(options).toHaveLength(11);
    const shortcuts = options.map((o) => o.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(shortcuts).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'R', '0']);
  });

  test('has Receipts entry reachable from the launcher', () => {
    const options = createMenuOptions();
    const receipts = options.find((o) => o.shortcut === 'R');
    expect(receipts).toBeDefined();
    expect(receipts!.title).toBe('Receipts');
  });

  test('has Export as item 2', () => {
    const options = createMenuOptions();
    const exportItem = options.find((o) => o.shortcut === '2');
    expect(exportItem).toBeDefined();
    expect(exportItem!.title).toBe('Export');
  });

  test('has Build Custom Command as item 0', () => {
    const options = createMenuOptions();
    const item0 = options.find((o) => o.shortcut === '0');
    expect(item0).toBeDefined();
    expect(item0!.title).toBe('Build Custom Command');
  });

  test('does not have separate Export JSON, Export SVG, or Export PNG items', () => {
    const options = createMenuOptions();
    const titles = options.map((o) => o.title);
    expect(titles).not.toContain('Export JSON');
    expect(titles).not.toContain('Export SVG');
    expect(titles).not.toContain('Export PNG');
  });

  test('every option has a select function', () => {
    const options = createMenuOptions();
    for (const option of options) {
      expect(typeof option.select).toBe('function');
    }
  });
});

describe('flag serialization', () => {
  test('buildCliArgTokens serializes booleans and values in CLI order', () => {
    expect(
      buildCliArgTokens({
        format: 'png',
        output: 'card.png',
        cursor: true,
        openCode: true,
        noColor: true,
      }),
    ).toEqual(['--format', 'png', '--output', 'card.png', '--cursor', '--open-code', '--no-color']);
  });

  test('buildCliPreview includes the tokenleak executable prefix', () => {
    expect(buildCliPreview({ format: 'json', output: 'out.json' })).toBe(
      'tokenleak --format json --output out.json',
    );
    expect(buildCliPreview({})).toBe('tokenleak');
  });

  test('buildCliPreview includes --advisor flag', () => {
    expect(buildCliPreview({ advisor: true })).toBe('tokenleak --advisor');
  });

  test('buildCliPreview combines advisor with other flags', () => {
    expect(buildCliPreview({ advisor: true, format: 'terminal', days: 30 })).toBe(
      'tokenleak --format terminal --days 30 --advisor',
    );
  });

  test('buildCliArgTokens emits --advisor', () => {
    expect(buildCliArgTokens({ advisor: true })).toEqual(['--advisor']);
  });
});

describe('interactive helpers', () => {
  test('finalizeCliArgs forces --more for image compare flows', () => {
    expect(finalizeCliArgs({ format: 'png', compare: 'auto' })).toMatchObject({
      format: 'png',
      compare: 'auto',
      more: true,
    });
  });

  test('finalizeCliArgs adds a default output when --open is requested for JSON', () => {
    expect(finalizeCliArgs({ format: 'json', open: true })).toMatchObject({
      format: 'json',
      open: true,
      output: 'tokenleak.json',
    });
  });

  test('stripAnsi removes ANSI escape sequences', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  test('visibleLength counts only printable characters', () => {
    expect(visibleLength('\x1b[31mred\x1b[0m')).toBe(3);
  });

  test('padVisible pads up to the requested width', () => {
    expect(padVisible('abc', 5)).toBe('abc  ');
  });

  test('truncateVisible preserves ANSI-wrapped content when truncating', () => {
    expect(truncateVisible('\x1b[32mhello-world\x1b[0m', 8)).toContain('\x1b[32m');
    expect(stripAnsi(truncateVisible('\x1b[32mhello-world\x1b[0m', 8))).toBe('hello...');
  });

  test('clampScrollOffset keeps the offset inside the visible range', () => {
    expect(clampScrollOffset(-5, 20, 8)).toBe(0);
    expect(clampScrollOffset(3, 20, 8)).toBe(3);
    expect(clampScrollOffset(50, 20, 8)).toBe(12);
  });

  test('buildOutputSectionLines preserves all lines instead of clipping them', () => {
    expect(buildOutputSectionLines('Output', 'a\nb\nc\nd', 20)).toEqual([
      expect.stringContaining('Output'),
      'a',
      'b',
      'c',
      'd',
      '',
    ]);
  });

  test('buildLauncherBody keeps the full two-column launcher in a large terminal', () => {
    const output = stripAnsi(
      buildLauncherBody(
        { version: '2.1.0', helpText: 'help' },
        createMenuOptions(),
        0,
        140,
        40,
      ).join('\n'),
    );

    expect(output).toContain('All Flags');
    expect(output).toContain('Launch Dashboard');
  });

  test('buildLauncherBody switches to a compact menu when the stacked launcher would overflow', () => {
    const output = stripAnsi(
      buildLauncherBody(
        { version: '2.1.0', helpText: 'help' },
        createMenuOptions(),
        0,
        88,
        20,
      ).join('\n'),
    );

    expect(output).not.toContain('All Flags');
    expect(output).toContain('Narrow pane detected. Press H for the full flag reference.');
    expect(output).toContain('Launch Dashboard');
  });

  test('buildLauncherBody keeps the selected action visible in compact mode', () => {
    const options = createMenuOptions();
    const customIndex = options.findIndex((o) => o.title === 'Build Custom Command');
    const output = stripAnsi(
      buildLauncherBody(
        { version: '2.1.0', helpText: 'help' },
        options,
        customIndex,
        88,
        12,
      ).join('\n'),
    );

    expect(output).toContain('Build Custom Command');
    expect(output).toContain('tokenleak --format terminal --days 90');
  });
});

describe('interactive summaries', () => {
  test('summarizes successful file output commands', () => {
    expect(buildInteractiveSummary({ format: 'svg', output: 'card.svg' }, true, 0)).toBe(
      'SVG written to card.svg.',
    );
  });

  test('summarizes list provider runs', () => {
    expect(buildInteractiveSummary({ listProviders: true }, true, 0)).toBe(
      'Provider registry loaded.',
    );
  });

  test('summarizes live server runs', () => {
    expect(buildInteractiveSummary({ liveServer: true }, true, 0)).toBe('Live dashboard stopped.');
  });

  test('summarizes compare runs', () => {
    expect(buildInteractiveSummary({ compare: 'auto' }, true, 0)).toBe('Compare report generated.');
  });

  test('summarizes explain runs', () => {
    expect(buildInteractiveSummary({ subcommand: 'explain' }, true, 0)).toBe(
      'Explain report generated.',
    );
  });

  test('summarizes focus runs', () => {
    expect(buildInteractiveSummary({ subcommand: 'focus' }, true, 0)).toBe(
      'Focus report generated.',
    );
  });

  test('summarizes terminal dashboard runs', () => {
    expect(buildInteractiveSummary({}, true, 0)).toBe('Terminal dashboard generated.');
  });

  test('summarizes failures using the exit code', () => {
    expect(buildInteractiveSummary({}, false, 130)).toBe('Command exited with code 130.');
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
    expect(config.width).toBe(80);
    expect(config.noColor).toBe(false);
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
    expect(config.width).toBe(80);
    expect(config.noColor).toBe(false);
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

  test('throws a login hint when cursor is requested without auth or cache', async () => {
    let thrown: unknown;
    try {
      await run({ format: 'json', provider: 'cursor' });
    } catch (error: unknown) {
      thrown = error;
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

  test('resolveTabbedDashboardProviders loads cursor from selected provider list', async () => {
    const { env, cleanup } = createProviderFixtureEnv();
    const previousEnv = process.env;

    try {
      process.env = env;
      const providers = await resolveTabbedDashboardProviders({ providerNames: ['cursor'] });
      expect(providers).toHaveLength(1);
      expect(providers[0]?.name).toBe('cursor');
    } finally {
      process.env = previousEnv;
      cleanup();
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
    expect(stdout).not.toContain('tokenleak waste');
    expect(stdout).toContain('interactive launcher');
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

  test('waste is not exposed as a standalone command', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'waste', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Advisor view for Waste Patterns');
  });

  test('--version prints version', async () => {
    const proc = Bun.spawn(['bun', cliPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('2.1.0');
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
    expect(stdout).toContain('pi');
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
      const proc = Bun.spawn(['bun', cliPath, 'focus', '--format', 'json', '--provider', 'pi'], {
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
      const proc = Bun.spawn(['bun', cliPath, 'focus', '--provider', 'pi'], {
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
    expect(stderr).toContain('tokenleak explain requires a <date> argument in YYYY-MM-DD format');
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

// --- tqdm-style progress bar ---

describe('tqdm-style progress bar', () => {
  test('contains braille spinner character', () => {
    const bar = renderProgressBar(0, 60, 5);
    expect(bar).toContain('⠋');
  });

  test('contains block characters', () => {
    const bar = renderProgressBar(5, 60, 10);
    // At frame 5, should have some filled blocks
    expect(bar).toContain('█');
    expect(bar).toContain('░');
  });

  test('contains elapsed time', () => {
    const bar = renderProgressBar(0, 60, 42);
    expect(bar).toContain('42s');
  });

  test('spinner cycles through braille chars', () => {
    const plain0 = stripAnsi(renderProgressBar(0, 60, 0));
    const plain1 = stripAnsi(renderProgressBar(1, 60, 0));
    // Different spinner chars
    expect(plain0[0]).not.toBe(plain1[0]);
  });

  test('adapts to narrow width', () => {
    const bar = renderProgressBar(3, 30, 5);
    const plain = stripAnsi(bar);
    // Should not crash, and should have some visible content
    expect(plain.length).toBeGreaterThan(10);
  });

  test('fill amount changes with frame', () => {
    const bar0 = stripAnsi(renderProgressBar(0, 60, 0));
    const bar10 = stripAnsi(renderProgressBar(10, 60, 0));
    const fill0 = (bar0.match(/█/g) || []).length;
    const fill10 = (bar10.match(/█/g) || []).length;
    expect(fill10).toBeGreaterThan(fill0);
  });
});
