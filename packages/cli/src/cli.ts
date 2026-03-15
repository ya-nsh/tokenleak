#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import { writeFileSync } from 'node:fs';
import {
  VERSION,
  DEFAULT_DAYS,
  SCHEMA_VERSION,
  aggregate,
  buildExplainReport,
  buildFocusReport,
  mergeProviderData,
  buildMoreStats,
} from '@tokenleak/core';
import type {
  DateRange,
  FocusReport,
  RenderOptions,
  TokenleakOutput,
  ProviderData,
} from '@tokenleak/core';
import {
  ProviderRegistry,
  ClaudeCodeProvider,
  CodexProvider,
  OpenCodeProvider,
  PiProvider,
} from '@tokenleak/registry';
import type { IProvider } from '@tokenleak/registry';
import { JsonRenderer, SvgRenderer, TerminalRenderer, PngRenderer, renderWrappedPng, startLiveServer } from '@tokenleak/renderers';
import type { IRenderer } from '@tokenleak/renderers';

import { loadConfig } from './config.js';
import { loadCompareTokenleakData, loadTokenleakData } from './data-loader.js';
import { computeDateRange } from './date-range.js';
import { loadEnvOverrides } from './env.js';
import { TokenleakError, handleError } from './errors.js';
import { buildExplainHelpText, renderExplainTerminal } from './explain.js';
import { buildCliArgTokens } from './flags.js';
import type { InteractiveExecutionResult, InteractiveRunRequest } from './interactive.js';
import { shouldStartInteractiveCli, startInteractiveCli } from './interactive.js';
import { copyToClipboard, openFile, uploadToGist } from './sharing/index.js';
import { startTabbedDashboard } from './tabbed-dashboard.js';
import type { TabbedDashboardOptions } from './tabbed-dashboard.js';

export { computeDateRange };

const FORMAT_VALUES = ['json', 'svg', 'png', 'terminal', 'wrapped'] as const;
const FOCUS_FORMAT_VALUES = ['json', 'terminal'] as const;
const THEME_VALUES = ['dark', 'light'] as const;
const PROVIDER_SHORTCUTS = {
  claude: 'claude-code',
  codex: 'codex',
  pi: 'pi',
  openCode: 'open-code',
} as const;
const PROVIDER_ALIASES: Record<string, string> = {
  anthropic: 'claude-code',
  claude: 'claude-code',
  'claude-code': 'claude-code',
  claudecode: 'claude-code',
  codex: 'codex',
  openai: 'codex',
  pi: 'pi',
  'pi-mono': 'pi',
  'open-code': 'open-code',
  open_code: 'open-code',
  opencode: 'open-code',
};
const PROVIDER_ALIAS_GROUPS: Record<string, string[]> = {
  'claude-code': ['anthropic', 'claude', 'claudecode'],
  codex: ['openai'],
  pi: ['pi-mono'],
  'open-code': ['opencode', 'open_code'],
};

interface ProviderFilterConfig {
  provider?: string;
  claude: boolean;
  codex: boolean;
  pi: boolean;
  openCode: boolean;
}

interface ProviderLoadConfig extends ProviderFilterConfig {
  since?: string;
  until?: string;
  days: number;
  allProviders: boolean;
}

interface FocusConfig extends ProviderLoadConfig {
  format: typeof FOCUS_FORMAT_VALUES[number];
  output: string | null;
  width: number;
  noColor: boolean;
  listProviders: boolean;
}

function normalizeProviderToken(token: string): string {
  const normalized = token.trim().toLowerCase().replace(/\s+/g, '-');
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

function getRequestedProviders(config: ProviderFilterConfig): Set<string> {
  const requested = new Set<string>();

  if (config.provider) {
    for (const token of config.provider.split(',')) {
      const normalized = normalizeProviderToken(token);
      if (normalized) {
        requested.add(normalized);
      }
    }
  }

  if (config.claude) requested.add(PROVIDER_SHORTCUTS.claude);
  if (config.codex) requested.add(PROVIDER_SHORTCUTS.codex);
  if (config.pi) requested.add(PROVIDER_SHORTCUTS.pi);
  if (config.openCode) requested.add(PROVIDER_SHORTCUTS.openCode);

  return requested;
}

function providerMatchesFilter(provider: IProvider, requested: Set<string>): boolean {
  if (requested.size === 0) return true;

  const candidates = [
    normalizeProviderToken(provider.name),
    normalizeProviderToken(provider.displayName),
  ];

  return candidates.some((candidate) => requested.has(candidate));
}

function buildHelpText(): string {
  return [
    `tokenleak ${VERSION}`,
    'Visualize AI coding assistant token usage across providers.',
    'Running `tokenleak` with no flags opens an interactive launcher in a TTY.',
    '',
    'Usage:',
    '  tokenleak [flags]',
    '  tokenleak explain <date> [flags]',
    '  tokenleak focus [flags]',
    '',
    'Subcommands:',
    '  explain <date>         Explain what drove usage on one day',
    '  focus                  Rank sessions by deep-work score',
    '',
    'Provider Shortcuts:',
    '  --claude                Only include Claude Code',
    '  --codex                 Only include Codex',
    '  --pi                    Only include Pi',
    '  --open-code             Only include OpenCode',
    '  --all-providers         Ignore provider filters and use every available provider',
    '  --list-providers        Show registered providers and aliases',
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal, png, svg, json, wrapped',
    '  -t, --theme <theme>     Theme for png/svg/live output: dark, light',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write output to a file and infer format from extension',
    '  -w, --width <number>    Terminal render width',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --compare <range>   Compare against YYYY-MM-DD..YYYY-MM-DD or auto',
    '      --more             Add expanded PNG/SVG stats and unlock compare cards',
    '      --clipboard         Copy rendered output to the clipboard',
    '      --open              Open the generated output file',
    '      --upload <target>   Upload rendered output, currently: gist',
    '  -L, --live-server       Start the interactive local dashboard',
    '      --no-color          Disable ANSI colors',
    '      --no-insights       Hide insights in terminal mode',
    '      --help              Show this help',
    '      --version           Show version information',
    '',
    'Examples:',
    '  tokenleak',
    '  tokenleak --claude --days 30',
    '  tokenleak --codex --format png --output codex.png',
    '  tokenleak --pi --days 30',
    '  tokenleak --open-code --since 2026-01-01 --until 2026-03-01',
    '  tokenleak --provider claude,codex,pi --format svg --output usage.svg',
    '  tokenleak --provider anthropic,openai,pi-mono',
    '  tokenleak --list-providers',
    '  tokenleak --compare auto --format terminal',
    '  tokenleak --live-server --theme light',
    '  tokenleak explain 2026-03-10',
    '  tokenleak explain 2026-03-10 --format json',
    '  tokenleak focus --provider codex --days 30',
    '',
    'Version:',
    `  CLI ${VERSION}`,
    `  Schema ${SCHEMA_VERSION}`,
    '',
  ].join('\n');
}

function buildFocusHelpText(): string {
  return [
    `tokenleak focus ${VERSION}`,
    'Rank sessions by a deep-work score built from duration, token density, and project streaks.',
    '',
    'Usage:',
    '  tokenleak focus [flags]',
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write output to a file and infer format from extension',
    '  -w, --width <number>    Terminal render width',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --claude            Only include Claude Code',
    '      --codex             Only include Codex',
    '      --pi                Only include Pi',
    '      --open-code         Only include OpenCode',
    '      --all-providers     Ignore provider filters and use every available provider',
    '      --list-providers    Show registered providers and aliases',
    '      --no-color          Disable ANSI colors in terminal output',
    '      --help              Show this help',
    '      --version           Show version information',
    '',
    'Examples:',
    '  tokenleak focus',
    '  tokenleak focus --provider claude,codex --days 30',
    '  tokenleak focus --format json --output focus.json',
    '',
  ].join('\n');
}

function buildVersionText(): string {
  return `tokenleak ${VERSION}\nschema ${SCHEMA_VERSION}\n`;
}

function normalizeCliArg(arg: string): string {
  const flagMap: Record<string, string> = {
    '--all-providers': '--allProviders',
    '--list-providers': '--listProviders',
    '--open-code': '--openCode',
    '--live-server': '--liveServer',
    '--no-color': '--noColor',
    '--no-insights': '--noInsights',
  };

  return flagMap[arg] ?? arg;
}

export function buildInteractiveSummary(cliArgs: Record<string, unknown>, ok: boolean, exitCode: number): string {
  if (!ok) {
    return `Command exited with code ${exitCode}.`;
  }

  if (typeof cliArgs['output'] === 'string') {
    const outputPath = cliArgs['output'];
    const format = String(cliArgs['format'] ?? inferFormatFromPath(outputPath) ?? 'output').toUpperCase();
    return `${format} written to ${outputPath}.`;
  }

  if (cliArgs['subcommand'] === 'explain') {
    return 'Explain report generated.';
  }

  if (cliArgs['subcommand'] === 'focus') {
    return 'Focus report generated.';
  }

  if (cliArgs['listProviders']) {
    return 'Provider registry loaded.';
  }

  if (cliArgs['liveServer']) {
    return 'Live dashboard stopped.';
  }

  if (cliArgs['compare']) {
    return 'Compare report generated.';
  }

  const format = String(cliArgs['format'] ?? 'terminal');
  if (format === 'terminal') {
    return 'Terminal dashboard generated.';
  }

  return `${format.toUpperCase()} command finished successfully.`;
}

async function executeInteractiveCommand(
  request: InteractiveRunRequest,
): Promise<InteractiveExecutionResult> {
  try {
    const cliPath = process.argv[1];
    if (!cliPath) {
      return {
        ok: false,
        summary: 'Could not resolve the current tokenleak entrypoint.',
        stdout: '',
        stderr: 'Error: process.argv[1] is missing.',
      };
    }

    const command = [process.execPath, cliPath, ...(request.argv ?? buildCliArgTokens(request.args))];

    if (request.executionMode === 'inherit') {
      const proc = Bun.spawn(command, {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      const exitCode = await proc.exited;
      return {
        ok: exitCode === 0,
        summary: buildInteractiveSummary(request.args, exitCode === 0, exitCode),
        stdout: '',
        stderr: '',
      };
    }

    const proc = Bun.spawn(command, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    return {
      ok: exitCode === 0,
      summary: buildInteractiveSummary(request.args, exitCode === 0, exitCode),
      stdout,
      stderr,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      summary: 'Interactive command failed before it could finish.',
      stdout: '',
      stderr: error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`,
    };
  }
}

export function normalizeCliArgv(argv: string[]): string[] {
  const normalized = argv.map(normalizeCliArg);
  const result: string[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const arg = normalized[i]!;

    if (arg === '--provider' || arg === '-p') {
      result.push(arg);

      const providerParts: string[] = [];
      let j = i + 1;
      while (j < normalized.length) {
        const next = normalized[j]!;
        if (next.startsWith('-')) break;
        providerParts.push(next);
        j++;
      }

      if (providerParts.length > 0) {
        result.push(providerParts.join(' '));
        i = j - 1;
      }

      continue;
    }

    result.push(arg);
  }

  return result;
}

function registerBuiltInProviders(registry: ProviderRegistry): void {
  registry.register(new ClaudeCodeProvider());
  registry.register(new CodexProvider());
  registry.register(new PiProvider());
  registry.register(new OpenCodeProvider());
}

function buildProviderList(providers: IProvider[], availability: Map<string, boolean>): string {
  const lines = ['Registered providers:', ''];

  for (const provider of providers) {
    const aliases = PROVIDER_ALIAS_GROUPS[provider.name] ?? [];
    const status = availability.get(provider.name) ? 'available' : 'unavailable';
    lines.push(`- ${provider.name} (${provider.displayName}) [${status}]`);
    if (aliases.length > 0) {
      lines.push(`  aliases: ${aliases.join(', ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function createRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registerBuiltInProviders(registry);
  return registry;
}

function validateProviderSelection(config: Pick<ProviderLoadConfig, 'allProviders'> & ProviderFilterConfig): void {
  if (config.allProviders && (
    config.provider ||
    config.claude ||
    config.codex ||
    config.pi ||
    config.openCode
  )) {
    throw new TokenleakError('--all-providers cannot be combined with provider filters');
  }
}

async function selectAvailableProviders(
  config: Pick<ProviderLoadConfig, 'allProviders'> & ProviderFilterConfig,
): Promise<IProvider[]> {
  validateProviderSelection(config);

  const registry = createRegistry();
  let available = await registry.getAvailable();

  const requestedProviders = getRequestedProviders(config);
  if (!config.allProviders && requestedProviders.size > 0) {
    if (config.provider && (config.claude || config.codex || config.pi || config.openCode)) {
      process.stderr.write(
        `Combining provider filters: ${Array.from(requestedProviders).join(', ')}\n`,
      );
    }
    available = available.filter((provider) => providerMatchesFilter(provider, requestedProviders));
  }

  return available;
}

async function loadProviderData(config: ProviderLoadConfig): Promise<{
  dateRange: DateRange;
  providerDataList: ProviderData[];
}> {
  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });

  return loadProviderDataForRange(config, dateRange);
}

async function loadProviderDataForRange(
  config: Pick<ProviderLoadConfig, 'allProviders'> & ProviderFilterConfig,
  dateRange: DateRange,
  available: IProvider[] | null = null,
): Promise<{
  dateRange: DateRange;
  providerDataList: ProviderData[];
}> {
  const resolvedProviders = available ?? await selectAvailableProviders(config);
  const availableProviders = resolvedProviders;
  if (availableProviders.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const results = await Promise.all(
    availableProviders.map(async (provider) => {
      try {
        return await provider.load(dateRange);
      } catch {
        return null;
      }
    }),
  );

  const providerDataList = results.filter((result): result is ProviderData => result !== null);
  if (providerDataList.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  return { dateRange, providerDataList };
}

/** Infer format from output file extension. */
export function inferFormatFromPath(filePath: string): typeof FORMAT_VALUES[number] | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'json':
      return 'json';
    case 'svg':
      return 'svg';
    case 'png':
      return 'png';
    default:
      return null;
  }
}

/** Resolve effective config by merging config file, env vars, and CLI flags. */
export function resolveConfig(cliArgs: Record<string, unknown>): {
  format: typeof FORMAT_VALUES[number];
  theme: typeof THEME_VALUES[number];
  since?: string;
  until?: string;
  days: number;
  output: string | null;
  width: number;
  noColor: boolean;
  noInsights: boolean;
  more: boolean;
  compare?: string;
  provider?: string;
  claude: boolean;
  codex: boolean;
  pi: boolean;
  openCode: boolean;
  allProviders: boolean;
  listProviders: boolean;
  clipboard: boolean;
  open: boolean;
  upload?: string;
  liveServer: boolean;
} {
  const fileConfig = loadConfig();
  const envConfig = loadEnvOverrides();

  type Format = typeof FORMAT_VALUES[number];
  type Theme = typeof THEME_VALUES[number];

  // Defaults
  const merged: {
    format: Format;
    theme: Theme;
    days: number;
    output: string | null;
    width: number;
    noColor: boolean;
    noInsights: boolean;
    more: boolean;
    claude: boolean;
    codex: boolean;
    pi: boolean;
    openCode: boolean;
    allProviders: boolean;
    listProviders: boolean;
    clipboard: boolean;
    open: boolean;
    liveServer: boolean;
  } = {
    format: 'terminal',
    theme: 'dark',
    days: DEFAULT_DAYS,
    output: null,
    width: 80,
    noColor: false,
    noInsights: false,
    more: false,
    claude: false,
    codex: false,
    pi: false,
    openCode: false,
    allProviders: false,
    listProviders: false,
    clipboard: false,
    open: false,
    liveServer: false,
  };

  // Layer: defaults < file config < env vars < CLI flags

  // File config
  if (fileConfig.format && FORMAT_VALUES.includes(fileConfig.format)) {
    merged.format = fileConfig.format;
  }
  if (fileConfig.theme && THEME_VALUES.includes(fileConfig.theme)) {
    merged.theme = fileConfig.theme;
  }
  if (fileConfig.days !== undefined) merged.days = fileConfig.days;
  if (fileConfig.width !== undefined) merged.width = fileConfig.width;
  if (fileConfig.noColor !== undefined) merged.noColor = fileConfig.noColor;
  if (fileConfig.noInsights !== undefined) merged.noInsights = fileConfig.noInsights;
  if (fileConfig.more !== undefined) merged.more = fileConfig.more;

  // Env overrides
  if (envConfig.format) merged.format = envConfig.format;
  if (envConfig.theme) merged.theme = envConfig.theme;
  if (envConfig.days !== undefined) merged.days = envConfig.days;

  // CLI flags (only override if explicitly provided)
  const result: ReturnType<typeof resolveConfig> = { ...merged };

  if (cliArgs['format'] !== undefined) {
    result.format = cliArgs['format'] as typeof FORMAT_VALUES[number];
  }
  if (cliArgs['theme'] !== undefined) {
    result.theme = cliArgs['theme'] as typeof THEME_VALUES[number];
  }
  if (cliArgs['since'] !== undefined) {
    result.since = cliArgs['since'] as string;
  }
  if (cliArgs['until'] !== undefined) {
    result.until = cliArgs['until'] as string;
  }
  if (cliArgs['days'] !== undefined) {
    result.days = cliArgs['days'] as number;
  }
  if (cliArgs['output'] !== undefined) {
    const outputPath = cliArgs['output'] as string;
    result.output = outputPath;
    // Infer format from output extension if format was not explicitly set
    if (cliArgs['format'] === undefined) {
      const inferred = inferFormatFromPath(outputPath);
      if (inferred) {
        result.format = inferred;
      }
    }
  }
  if (cliArgs['width'] !== undefined) {
    result.width = cliArgs['width'] as number;
  }
  if (cliArgs['noColor'] !== undefined) {
    result.noColor = cliArgs['noColor'] as boolean;
  }
  if (cliArgs['noInsights'] !== undefined) {
    result.noInsights = cliArgs['noInsights'] as boolean;
  }
  if (cliArgs['more'] !== undefined) {
    result.more = cliArgs['more'] as boolean;
  }
  if (cliArgs['compare'] !== undefined) {
    result.compare = cliArgs['compare'] as string;
  }
  if (cliArgs['provider'] !== undefined) {
    result.provider = cliArgs['provider'] as string;
  }
  if (cliArgs['claude'] !== undefined) {
    result.claude = cliArgs['claude'] as boolean;
  }
  if (cliArgs['codex'] !== undefined) {
    result.codex = cliArgs['codex'] as boolean;
  }
  if (cliArgs['pi'] !== undefined) {
    result.pi = cliArgs['pi'] as boolean;
  }
  if (cliArgs['openCode'] !== undefined) {
    result.openCode = cliArgs['openCode'] as boolean;
  }
  if (cliArgs['allProviders'] !== undefined) {
    result.allProviders = cliArgs['allProviders'] as boolean;
  }
  if (cliArgs['listProviders'] !== undefined) {
    result.listProviders = cliArgs['listProviders'] as boolean;
  }
  if (cliArgs['clipboard'] !== undefined) {
    result.clipboard = cliArgs['clipboard'] as boolean;
  }
  if (cliArgs['open'] !== undefined) {
    result.open = cliArgs['open'] as boolean;
  }
  if (cliArgs['upload'] !== undefined) {
    result.upload = cliArgs['upload'] as string;
  }
  if (cliArgs['liveServer'] !== undefined) {
    result.liveServer = cliArgs['liveServer'] as boolean;
  }

  return result;
}

export function resolveFocusConfig(cliArgs: Record<string, unknown>): FocusConfig {
  const fileConfig = loadConfig();
  const envConfig = loadEnvOverrides();

  const merged: FocusConfig = {
    format: 'terminal',
    since: undefined,
    until: undefined,
    days: DEFAULT_DAYS,
    output: null,
    width: 80,
    noColor: false,
    provider: undefined,
    claude: false,
    codex: false,
    pi: false,
    openCode: false,
    allProviders: false,
    listProviders: false,
  };

  if (fileConfig.format && FOCUS_FORMAT_VALUES.includes(fileConfig.format as typeof FOCUS_FORMAT_VALUES[number])) {
    merged.format = fileConfig.format as typeof FOCUS_FORMAT_VALUES[number];
  }
  if (fileConfig.days !== undefined) merged.days = fileConfig.days;
  if (fileConfig.width !== undefined) merged.width = fileConfig.width;
  if (fileConfig.noColor !== undefined) merged.noColor = fileConfig.noColor;

  if (
    envConfig.format &&
    FOCUS_FORMAT_VALUES.includes(envConfig.format as typeof FOCUS_FORMAT_VALUES[number])
  ) {
    merged.format = envConfig.format as typeof FOCUS_FORMAT_VALUES[number];
  }
  if (envConfig.days !== undefined) merged.days = envConfig.days;

  const result: FocusConfig = { ...merged };

  if (cliArgs['format'] !== undefined) {
    const format = cliArgs['format'] as string;
    if (!FOCUS_FORMAT_VALUES.includes(format as typeof FOCUS_FORMAT_VALUES[number])) {
      throw new TokenleakError(
        `Unsupported focus format: "${format}". Available: ${FOCUS_FORMAT_VALUES.join(', ')}`,
      );
    }
    result.format = format as typeof FOCUS_FORMAT_VALUES[number];
  }
  if (cliArgs['since'] !== undefined) {
    result.since = cliArgs['since'] as string;
  }
  if (cliArgs['until'] !== undefined) {
    result.until = cliArgs['until'] as string;
  }
  if (cliArgs['days'] !== undefined) {
    result.days = cliArgs['days'] as number;
  }
  if (cliArgs['output'] !== undefined) {
    const outputPath = cliArgs['output'] as string;
    result.output = outputPath;
    if (cliArgs['format'] === undefined) {
      const inferred = inferFormatFromPath(outputPath);
      if (inferred === 'json') {
        result.format = 'json';
      }
    }
  }
  if (cliArgs['width'] !== undefined) {
    result.width = cliArgs['width'] as number;
  }
  if (cliArgs['noColor'] !== undefined) {
    result.noColor = cliArgs['noColor'] as boolean;
  }
  if (cliArgs['provider'] !== undefined) {
    result.provider = cliArgs['provider'] as string;
  }
  if (cliArgs['claude'] !== undefined) {
    result.claude = cliArgs['claude'] as boolean;
  }
  if (cliArgs['codex'] !== undefined) {
    result.codex = cliArgs['codex'] as boolean;
  }
  if (cliArgs['pi'] !== undefined) {
    result.pi = cliArgs['pi'] as boolean;
  }
  if (cliArgs['openCode'] !== undefined) {
    result.openCode = cliArgs['openCode'] as boolean;
  }
  if (cliArgs['allProviders'] !== undefined) {
    result.allProviders = cliArgs['allProviders'] as boolean;
  }
  if (cliArgs['listProviders'] !== undefined) {
    result.listProviders = cliArgs['listProviders'] as boolean;
  }

  return result;
}

/** Get a renderer for the given format. */
function getRenderer(format: string): IRenderer {
  switch (format) {
    case 'json':
      return new JsonRenderer();
    case 'svg':
      return new SvgRenderer();
    case 'terminal':
      return new TerminalRenderer();
    case 'png':
      return new PngRenderer();
    default:
      throw new TokenleakError(
        `Format "${format}" is not supported. Available formats: json, svg, png, terminal, wrapped`,
      );
  }
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, ' ');
}

function truncateCell(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 3) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 3)}...`;
}

function formatFocusDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return '-';
  }

  const minutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${remainder}m`;
  }

  if (remainder === 0) {
    return `${hours}h`;
  }

  return `${hours}h${String(remainder).padStart(2, '0')}m`;
}

function formatFocusDensity(tokensPerHour: number): string {
  return `${Math.round(tokensPerHour).toLocaleString('en-US')}/h`;
}

function renderFocusReport(report: FocusReport, width: number, _noColor: boolean): string {
  const safeWidth = Math.max(72, width || 80);
  const labelWidth = Math.max(16, safeWidth - 50);
  const lines = [
    'Tokenleak Focus',
    report.method,
    '',
    `${report.entries.length} sessions ranked by deep-work score.`,
  ];

  if (report.entries.length === 0) {
    lines.push('', 'No session data available.');
    return lines.join('\n');
  }

  lines.push(
    '',
    `${padCell('Score', 6)} ${padCell('Dur', 7)} ${padCell('Density', 12)} ${padCell('Stk', 4)} ${padCell('Provider', 11)} ${padCell('Label', labelWidth)}`,
    `${'-'.repeat(6)} ${'-'.repeat(7)} ${'-'.repeat(12)} ${'-'.repeat(4)} ${'-'.repeat(11)} ${'-'.repeat(labelWidth)}`,
  );

  for (const entry of report.entries) {
    lines.push(
      `${padCell(entry.score.toFixed(1), 6)} ${padCell(formatFocusDuration(entry.durationMs), 7)} ${padCell(formatFocusDensity(entry.tokensPerHour), 12)} ${padCell(`${entry.streak}d`, 4)} ${padCell(entry.provider, 11)} ${truncateCell(entry.label, labelWidth)}`,
    );
    lines.push(`       ${truncateCell(entry.rationale.join(' | '), safeWidth - 7)}`);
  }

  return lines.join('\n');
}

export async function runFocus(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveFocusConfig(cliArgs);

  if (!FOCUS_FORMAT_VALUES.includes(config.format)) {
    throw new TokenleakError(
      `Format "${config.format}" is not supported for focus. Available formats: json, terminal`,
    );
  }

  if (config.listProviders) {
    const registry = createRegistry();
    const providers = registry.getAll();
    const availabilityResults = await Promise.all(
      providers.map(async (provider) => [provider.name, await provider.isAvailable()] as const),
    );
    process.stdout.write(buildProviderList(providers, new Map(availabilityResults)));
    return;
  }

  const { providerDataList } = await loadProviderData(config);
  const report = buildFocusReport(providerDataList.flatMap((provider) => provider.events ?? []));

  if (report.entries.length === 0) {
    throw new TokenleakError('No event-level data found for focus analysis');
  }

  const rendered = config.format === 'json'
    ? JSON.stringify(report, null, 2)
    : renderFocusReport(report, config.width, config.noColor);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

/** Main execution function, exported for testing. */
export async function run(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  validateProviderSelection(config);

  const registry = createRegistry();

  if (config.listProviders) {
    const providers = registry.getAll();
    const availabilityResults = await Promise.all(
      providers.map(async (provider) => [provider.name, await provider.isAvailable()] as const),
    );
    process.stdout.write(buildProviderList(providers, new Map(availabilityResults)));
    return;
  }

  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });

  const available = await selectAvailableProviders(config);

  if (available.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  // Handle --compare mode.
  if (config.compare) {
    const compareResult = await loadCompareTokenleakData(available, dateRange, config.compare);

    if (config.more && (config.format === 'png' || config.format === 'svg')) {
      const renderer = getRenderer(config.format);
      const renderOptions: RenderOptions = {
        format: config.format,
        theme: config.theme,
        width: config.width,
        showInsights: !config.noInsights,
        noColor: config.noColor,
        output: config.output,
        more: true,
      };

      const rendered = await renderer.render(compareResult.output, renderOptions);
      if (config.output) {
        const data = typeof rendered === 'string' ? rendered : Buffer.from(rendered);
        writeFileSync(config.output, data);
      } else {
        const text = typeof rendered === 'string' ? rendered : rendered.toString('utf-8');
        process.stdout.write(text + '\n');
      }
      return;
    }

    if (config.format === 'terminal') {
      const renderer = getRenderer('terminal');
      const renderOptions: RenderOptions = {
        format: 'terminal',
        theme: config.theme,
        width: config.width,
        showInsights: !config.noInsights,
        noColor: config.noColor,
        output: config.output,
        more: true,
      };

      const rendered = await renderer.render(compareResult.output, renderOptions);
      if (config.output) {
        writeFileSync(config.output, rendered);
      } else {
        process.stdout.write(`${rendered}\n`);
      }
      return;
    }

    if (config.format !== 'json') {
      process.stderr.write(
        `Warning: --compare only supports JSON output. Ignoring --format ${config.format}.\n`,
      );
    }
    const rendered = JSON.stringify(compareResult.compareOutput, null, 2);
    if (config.output) {
      writeFileSync(config.output, rendered);
    } else {
      process.stdout.write(rendered + '\n');
    }
    return;
  }

  const { providerDataList } = await loadProviderDataForRange(config, dateRange, available);

  // Merge and aggregate
  const mergedDaily = mergeProviderData(providerDataList);
  const stats = aggregate(mergedDaily, dateRange.until);

  const output: TokenleakOutput = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange,
    providers: providerDataList,
    aggregated: stats,
    more: (config.more || config.format === 'wrapped') ? buildMoreStats(providerDataList, dateRange) : null,
  };

  // Wrapped format — special rendering path
  if (config.format === 'wrapped') {
    const outputPath = config.output ?? 'tokenleak-wrapped.png';
    const wrappedBuffer = await renderWrappedPng(output, { theme: config.theme });
    writeFileSync(outputPath, wrappedBuffer);
    process.stderr.write(`Wrapped PNG written to ${outputPath}\n`);

    if (config.clipboard) {
      process.stderr.write('Clipboard is not supported for binary PNG output. Use --output to save the file.\n');
    }
    if (config.open) {
      await openFile(outputPath);
      process.stderr.write(`Opened ${outputPath} in default application.\n`);
    }
    if (config.upload === 'gist') {
      const base64Content = wrappedBuffer.toString('base64');
      const filename = 'tokenleak-wrapped.base64.txt';
      const description = `Tokenleak Wrapped (${dateRange.since} to ${dateRange.until}) — base64-encoded PNG, decode with: base64 -d tokenleak-wrapped.base64.txt > wrapped.png`;
      const url = await uploadToGist(base64Content, filename, description);
      process.stderr.write(`Uploaded to gist: ${url}\n`);
    } else if (config.upload !== undefined) {
      throw new TokenleakError(
        `Unknown upload target "${config.upload}". Supported: gist`,
      );
    }
    return;
  }

  // Live server mode
  if (config.liveServer) {
    const ignoredFlags: string[] = [];
    if (config.output) ignoredFlags.push('--output');
    if (config.clipboard) ignoredFlags.push('--clipboard');
    if (config.open) ignoredFlags.push('--open');
    if (config.upload) ignoredFlags.push('--upload');
    if (ignoredFlags.length > 0) {
      process.stderr.write(
        `Warning: ${ignoredFlags.join(', ')} ignored in --live-server mode.\n`,
      );
    }

    const renderOptions: RenderOptions = {
      format: config.format,
      theme: config.theme,
      width: config.width,
      showInsights: !config.noInsights,
      noColor: config.noColor,
      output: config.output,
      more: config.more,
    };
    const { port } = await startLiveServer(output, renderOptions);
    // Keep process alive until interrupted
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        process.stderr.write('\nShutting down server...\n');
        resolve();
      });
      process.on('SIGTERM', () => {
        resolve();
      });
    });
    return;
  }

  // Render
  const renderer = getRenderer(config.format);
  const renderOptions: RenderOptions = {
    format: config.format,
    theme: config.theme,
    width: config.width,
    showInsights: !config.noInsights,
    noColor: config.noColor,
    output: config.output,
    more: config.more,
  };

  const rendered = await renderer.render(output, renderOptions);

  // Output
  if (config.output) {
    const data = typeof rendered === 'string' ? rendered : Buffer.from(rendered);
    writeFileSync(config.output, data);
  } else {
    const text = typeof rendered === 'string' ? rendered : rendered.toString('utf-8');
    process.stdout.write(text + '\n');
  }

  // Sharing: clipboard
  if (config.clipboard) {
    const text = typeof rendered === 'string' ? rendered : rendered.toString('utf-8');
    await copyToClipboard(text);
    process.stderr.write('Copied output to clipboard.\n');
  }

  // Sharing: open file
  if (config.open) {
    if (!config.output) {
      throw new TokenleakError('--open requires --output to specify a file path');
    }
    await openFile(config.output);
    process.stderr.write(`Opened ${config.output} in default application.\n`);
  }

  // Sharing: upload to gist
  if (config.upload === 'gist') {
    const text = typeof rendered === 'string' ? rendered : rendered.toString('utf-8');
    const ext = config.format === 'json' ? 'json' : config.format === 'svg' ? 'svg' : 'txt';
    const filename = `tokenleak.${ext}`;
    const description = `Tokenleak report (${dateRange.since} to ${dateRange.until})`;
    const url = await uploadToGist(text, filename, description);
    process.stderr.write(`Uploaded to gist: ${url}\n`);
  } else if (config.upload !== undefined) {
    throw new TokenleakError(
      `Unknown upload target "${config.upload}". Supported: gist`,
    );
  }
}

function isValidDateArgument(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function parseExplainArgs(argv: string[]): { date: string; cliArgs: Record<string, unknown> } {
  if (argv.length === 0 || argv[0]?.startsWith('-')) {
    throw new TokenleakError('tokenleak explain requires a <date> argument in YYYY-MM-DD format');
  }

  const date = argv[0]!;
  if (!isValidDateArgument(date)) {
    throw new TokenleakError('tokenleak explain requires a <date> argument in YYYY-MM-DD format');
  }

  const cliArgs: Record<string, unknown> = {};
  let index = 1;

  while (index < argv.length) {
    const arg = argv[index]!;
    switch (arg) {
      case '--help':
      case '-h':
        cliArgs['help'] = true;
        index += 1;
        break;
      case '--version':
      case '-v':
        cliArgs['version'] = true;
        index += 1;
        break;
      case '--format':
      case '-f':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['format'] = argv[index + 1]!;
        index += 2;
        break;
      case '--output':
      case '-o':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['output'] = argv[index + 1]!;
        index += 2;
        break;
      case '--width':
      case '-w':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['width'] = Number(argv[index + 1]!);
        index += 2;
        break;
      case '--provider':
      case '-p':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['provider'] = argv[index + 1]!;
        index += 2;
        break;
      case '--claude':
        cliArgs['claude'] = true;
        index += 1;
        break;
      case '--codex':
        cliArgs['codex'] = true;
        index += 1;
        break;
      case '--pi':
        cliArgs['pi'] = true;
        index += 1;
        break;
      case '--openCode':
      case '--open-code':
        cliArgs['openCode'] = true;
        index += 1;
        break;
      case '--allProviders':
      case '--all-providers':
        cliArgs['allProviders'] = true;
        index += 1;
        break;
      case '--noColor':
      case '--no-color':
        cliArgs['noColor'] = true;
        index += 1;
        break;
      default:
        throw new TokenleakError(`Unknown explain flag "${arg}"`);
    }
  }

  return { date, cliArgs };
}

function resolveExplainFormat(cliArgs: Record<string, unknown>): 'json' | 'terminal' {
  if (typeof cliArgs['format'] === 'string') {
    const format = cliArgs['format'];
    if (format === 'json' || format === 'terminal') {
      return format;
    }

    throw new TokenleakError('tokenleak explain only supports --format terminal or --format json');
  }

  if (typeof cliArgs['output'] === 'string') {
    const inferred = inferFormatFromPath(cliArgs['output']);
    if (inferred === 'json') {
      return 'json';
    }
  }

  return 'terminal';
}

async function runExplain(date: string, cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  const format = resolveExplainFormat(cliArgs);

  if (config.allProviders && (
    config.provider ||
    config.claude ||
    config.codex ||
    config.pi ||
    config.openCode
  )) {
    throw new TokenleakError('--all-providers cannot be combined with provider filters');
  }

  const explainRange = computeDateRange({ until: date, days: 30 });
  const registry = new ProviderRegistry();
  registerBuiltInProviders(registry);

  let available = await registry.getAvailable();
  const requestedProviders = getRequestedProviders(config);
  if (!config.allProviders && requestedProviders.size > 0) {
    available = available.filter((provider) => providerMatchesFilter(provider, requestedProviders));
  }

  if (available.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const explainOutput = await loadTokenleakData(available, explainRange);
  const report = buildExplainReport(explainOutput.providers, date);
  const rendered = format === 'json'
    ? JSON.stringify(report, null, 2)
    : renderExplainTerminal(report, config.width);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(rendered + '\n');
  }
}

const main = defineCommand({
  meta: {
    name: 'tokenleak',
    version: VERSION,
    description:
      'Visualise your AI coding-assistant token usage across providers',
  },
  args: {
    format: {
      type: 'string',
      alias: 'f',
      description: 'Output format: json, svg, png, terminal, wrapped',
    },
    theme: {
      type: 'string',
      alias: 't',
      description: 'Color theme: dark, light',
    },
    since: {
      type: 'string',
      alias: 's',
      description: 'Start date (YYYY-MM-DD)',
    },
    until: {
      type: 'string',
      alias: 'u',
      description: 'End date (YYYY-MM-DD), defaults to today',
    },
    days: {
      type: 'string',
      alias: 'd',
      description: `Number of days to look back (default: ${DEFAULT_DAYS}, overridden by --since)`,
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output file path',
    },
    width: {
      type: 'string',
      alias: 'w',
      description: 'Terminal width (default: 80)',
    },
    noColor: {
      type: 'boolean',
      description: 'Disable ANSI colors',
      default: false,
    },
    noInsights: {
      type: 'boolean',
      description: 'Hide insights panel',
      default: false,
    },
    more: {
      type: 'boolean',
      description: 'Add expanded PNG/SVG stats and compare cards',
      default: false,
    },
    compare: {
      type: 'string',
      description: 'Compare two date ranges (YYYY-MM-DD..YYYY-MM-DD)',
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Filter to specific provider(s), comma-separated',
    },
    claude: {
      type: 'boolean',
      description: 'Shortcut for --provider claude-code',
      default: false,
    },
    codex: {
      type: 'boolean',
      description: 'Shortcut for --provider codex',
      default: false,
    },
    pi: {
      type: 'boolean',
      description: 'Shortcut for --provider pi',
      default: false,
    },
    openCode: {
      type: 'boolean',
      description: 'Shortcut for --provider open-code',
      default: false,
    },
    allProviders: {
      type: 'boolean',
      description: 'Ignore provider filters and use every available provider',
      default: false,
    },
    listProviders: {
      type: 'boolean',
      description: 'List registered providers and aliases',
      default: false,
    },
    clipboard: {
      type: 'boolean',
      description: 'Copy output to clipboard after rendering',
      default: false,
    },
    open: {
      type: 'boolean',
      description: 'Open output file in default application (requires --output)',
      default: false,
    },
    upload: {
      type: 'string',
      description: 'Upload output to a service (supported: gist)',
    },
    liveServer: {
      type: 'boolean',
      alias: 'L',
      description: 'Start a local server with an interactive dashboard',
      default: false,
    },
  },
  async run({ args }) {
    try {
      // Convert string numeric args to numbers
      const cliArgs: Record<string, unknown> = {};
      if (args.format !== undefined) cliArgs['format'] = args.format;
      if (args.theme !== undefined) cliArgs['theme'] = args.theme;
      if (args.since !== undefined) cliArgs['since'] = args.since;
      if (args.until !== undefined) cliArgs['until'] = args.until;
      if (args.days !== undefined) cliArgs['days'] = Number(args.days);
      if (args.output !== undefined) cliArgs['output'] = args.output;
      if (args.width !== undefined) cliArgs['width'] = Number(args.width);
      if (args.noColor) cliArgs['noColor'] = true;
      if (args.noInsights) cliArgs['noInsights'] = true;
      if (args.more) cliArgs['more'] = true;
      if (args.compare !== undefined) cliArgs['compare'] = args.compare;
      if (args.provider !== undefined) cliArgs['provider'] = args.provider;
      if (args.claude) cliArgs['claude'] = true;
      if (args.codex) cliArgs['codex'] = true;
      if (args.pi) cliArgs['pi'] = true;
      if (args.openCode) cliArgs['openCode'] = true;
      if (args.allProviders) cliArgs['allProviders'] = true;
      if (args.listProviders) cliArgs['listProviders'] = true;
      if (args.clipboard) cliArgs['clipboard'] = true;
      if (args.open) cliArgs['open'] = true;
      if (args.upload !== undefined) cliArgs['upload'] = args.upload;
      if (args.liveServer) cliArgs['liveServer'] = true;

      await run(cliArgs);
    } catch (error: unknown) {
      handleError(error);
    }
  },
});

const focusMain = defineCommand({
  meta: {
    name: 'focus',
    version: VERSION,
    description: 'Rank sessions by deep-work score',
  },
  args: {
    format: {
      type: 'string',
      alias: 'f',
      description: 'Output format: terminal, json',
    },
    since: {
      type: 'string',
      alias: 's',
      description: 'Start date (YYYY-MM-DD)',
    },
    until: {
      type: 'string',
      alias: 'u',
      description: 'End date (YYYY-MM-DD), defaults to today',
    },
    days: {
      type: 'string',
      alias: 'd',
      description: `Number of days to look back (default: ${DEFAULT_DAYS}, overridden by --since)`,
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output file path',
    },
    width: {
      type: 'string',
      alias: 'w',
      description: 'Terminal width (default: 80)',
    },
    noColor: {
      type: 'boolean',
      description: 'Disable ANSI colors',
      default: false,
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Filter to specific provider(s), comma-separated',
    },
    claude: {
      type: 'boolean',
      description: 'Shortcut for --provider claude-code',
      default: false,
    },
    codex: {
      type: 'boolean',
      description: 'Shortcut for --provider codex',
      default: false,
    },
    pi: {
      type: 'boolean',
      description: 'Shortcut for --provider pi',
      default: false,
    },
    openCode: {
      type: 'boolean',
      description: 'Shortcut for --provider open-code',
      default: false,
    },
    allProviders: {
      type: 'boolean',
      description: 'Ignore provider filters and use every available provider',
      default: false,
    },
    listProviders: {
      type: 'boolean',
      description: 'List registered providers and aliases',
      default: false,
    },
  },
  async run({ args }) {
    try {
      const cliArgs: Record<string, unknown> = {};
      if (args.format !== undefined) cliArgs['format'] = args.format;
      if (args.since !== undefined) cliArgs['since'] = args.since;
      if (args.until !== undefined) cliArgs['until'] = args.until;
      if (args.days !== undefined) cliArgs['days'] = Number(args.days);
      if (args.output !== undefined) cliArgs['output'] = args.output;
      if (args.width !== undefined) cliArgs['width'] = Number(args.width);
      if (args.noColor) cliArgs['noColor'] = true;
      if (args.provider !== undefined) cliArgs['provider'] = args.provider;
      if (args.claude) cliArgs['claude'] = true;
      if (args.codex) cliArgs['codex'] = true;
      if (args.pi) cliArgs['pi'] = true;
      if (args.openCode) cliArgs['openCode'] = true;
      if (args.allProviders) cliArgs['allProviders'] = true;
      if (args.listProviders) cliArgs['listProviders'] = true;

      await runFocus(cliArgs);
    } catch (error: unknown) {
      handleError(error);
    }
  },
});

// Only run when executed directly, not when imported by tests
const isDirectExecution =
  typeof Bun !== 'undefined'
    ? Bun.main === import.meta.path
    : process.argv[1] !== undefined &&
      import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isDirectExecution) {
  const normalizedArgv = normalizeCliArgv(process.argv.slice(2));
  const argv = normalizedArgv;

  if (argv[0] === 'explain') {
    try {
      const { date, cliArgs } = parseExplainArgs(argv.slice(1));

      if (cliArgs['help']) {
        process.stdout.write(buildExplainHelpText());
        process.exit(0);
      }

      if (cliArgs['version']) {
        process.stdout.write(buildVersionText());
        process.exit(0);
      }

      await runExplain(date, cliArgs);
      process.exit(0);
    } catch (error: unknown) {
      handleError(error);
    }
  }
  if (argv[0] === 'focus') {
    const focusArgv = argv.slice(1);
    process.argv = [...process.argv.slice(0, 2), ...focusArgv];

    if (focusArgv.includes('--help') || focusArgv.includes('-h')) {
      process.stdout.write(buildFocusHelpText());
      process.exit(0);
    }

    if (focusArgv.includes('--version') || focusArgv.includes('-v')) {
      process.stdout.write(buildVersionText());
      process.exit(0);
    }

    await runMain(focusMain);
    process.exit(0);
  }

  process.argv = [...process.argv.slice(0, 2), ...normalizedArgv];
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(buildHelpText());
    process.exit(0);
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(buildVersionText());
    process.exit(0);
  }

  if (shouldStartInteractiveCli(argv, Boolean(process.stdin.isTTY), Boolean(process.stdout.isTTY))) {
    const registry = createRegistry();
    const available = await registry.getAvailable();

    const launchTabbed = async (opts: TabbedDashboardOptions): Promise<void> => {
      const requested = new Set(opts.providerNames ?? []);
      const scopedProviders = requested.size > 0
        ? available.filter((provider) => providerMatchesFilter(provider, requested))
        : available;

      if (scopedProviders.length === 0) {
        throw new TokenleakError('No provider data found');
      }

      await startTabbedDashboard(scopedProviders, opts);
    };

    await startInteractiveCli({
      version: VERSION,
      helpText: buildHelpText(),
    }, executeInteractiveCommand, launchTabbed);
  } else {
    await runMain(main);
  }
}
