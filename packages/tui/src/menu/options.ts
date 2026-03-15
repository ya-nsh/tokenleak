import type { TimeRange } from '@tokenleak/renderers';
import type {
  CliArgs,
  InteractiveCommand,
  InteractiveRunRequest,
  MenuOption,
  TabbedDashboardOptions,
} from './types.js';
import {
  buildCliArgTokens,
  buildCliPreview,
  buildTabbedDashboardOptions,
  computeDateRange,
  describeRequest,
  finalizeCliArgs,
} from './utils.js';

export const INTERACTIVE_FLAG_LINES = [
  '    explain <date>       explain one day of usage',
  '    focus                rank deep-work sessions',
  '-f, --format <format>   terminal | png | svg | json | wrapped',
  '-t, --theme <theme>     dark | light',
  '-s, --since <date>      YYYY-MM-DD start date',
  '-u, --until <date>      YYYY-MM-DD end date',
  '-d, --days <number>     trailing days window',
  '-o, --output <path>     write output to a file',
  '-w, --width <number>    terminal render width',
  '-p, --provider <list>   comma-separated providers',
  '    --claude            shortcut for Claude Code',
  '    --codex             shortcut for Codex',
  '    --pi                shortcut for Pi',
  '    --open-code         shortcut for Open Code',
  '    --all-providers     ignore provider filters',
  '    --list-providers    show provider registry',
  '    --compare <range>   auto or YYYY-MM-DD..YYYY-MM-DD',
  '    --more              richer PNG/SVG stats',
  '    --clipboard         copy rendered output',
  '    --open              open generated file',
  '    --upload <target>   gist',
  '-L, --live-server       local interactive dashboard',
  '    --wrapped-live      AI Wrapped presentation in browser',
  '    --no-color          disable ANSI colors',
  '    --no-insights       hide terminal insights',
  '    --help              print help',
  '    --version           print version',
] as const;

export type Choice<T extends string> = {
  value: T;
  label: string;
  description: string;
};

export const PROVIDER_CHOICES: readonly Choice<string>[] = [
  { value: 'claude-code', label: 'Claude Code', description: 'Anthropic project logs' },
  { value: 'codex', label: 'Codex', description: 'OpenAI session logs' },
  { value: 'pi', label: 'Pi', description: 'pi-mono local session logs' },
  { value: 'open-code', label: 'Open Code', description: 'Open Code storage and database' },
];

export const DATE_WINDOW_CHOICES: readonly Choice<string>[] = [
  { value: '7', label: 'Last 7 days', description: 'Quick recent snapshot' },
  { value: '30', label: 'Last 30 days', description: 'Short-term trend window' },
  { value: '90', label: 'Last 90 days', description: 'Default overview' },
  { value: '365', label: 'Last 365 days', description: 'Long-range usage pattern' },
  { value: 'custom', label: 'Custom range', description: 'Enter exact dates manually' },
];

export const THEME_CHOICES: readonly Choice<string>[] = [
  { value: 'dark', label: 'Dark', description: 'High-contrast dark canvas' },
  { value: 'light', label: 'Light', description: 'Bright export with light background' },
];

export const WIDTH_CHOICES: readonly Choice<string>[] = [
  { value: '80', label: '80 columns', description: 'Standard terminal width' },
  { value: '100', label: '100 columns', description: 'Balanced dashboard layout' },
  { value: '120', label: '120 columns', description: 'Wide dashboard layout' },
  { value: 'custom', label: 'Custom width', description: 'Enter an exact width' },
];

export const COMPARE_CHOICES: readonly Choice<string>[] = [
  { value: 'off', label: 'No compare', description: 'Render a standard single-period report' },
  { value: 'auto', label: 'Auto compare', description: 'Split the selected window automatically' },
  { value: 'custom', label: 'Custom compare range', description: 'Provide an explicit YYYY-MM-DD..YYYY-MM-DD range' },
];

export const FORMAT_CHOICES: readonly Choice<string>[] = [
  { value: 'terminal', label: 'Terminal', description: 'Dashboard in the current terminal' },
  { value: 'json', label: 'JSON', description: 'Structured machine-readable output' },
  { value: 'svg', label: 'SVG', description: 'Shareable vector export' },
  { value: 'png', label: 'PNG', description: 'Raster export for social and docs' },
  { value: 'wrapped', label: 'Wrapped', description: 'Your AI coding story card (PNG)' },
];

export const EXPORT_FORMAT_CHOICES: readonly Choice<string>[] = [
  { value: 'png', label: 'PNG', description: 'Raster export for social and docs' },
  { value: 'svg', label: 'SVG', description: 'Shareable vector card' },
  { value: 'json', label: 'JSON', description: 'Structured machine-readable output' },
];

function createRunCommand(args: CliArgs): InteractiveCommand {
  const finalizedArgs = finalizeCliArgs(args);
  return {
    type: 'run',
    request: {
      args: finalizedArgs,
      preview: buildCliPreview(finalizedArgs),
      argv: buildCliArgTokens(finalizedArgs),
      ...describeRequest(finalizedArgs),
    },
  };
}

function createSubcommandRunCommand(
  subcommand: string,
  args: CliArgs,
  positionalArgs: string[] = [],
  overrides: Partial<Pick<InteractiveRunRequest, 'title' | 'loadingTitle' | 'loadingDetail' | 'executionMode'>> = {},
): InteractiveCommand {
  const finalizedArgs = finalizeCliArgs(args);
  const argv = [subcommand, ...positionalArgs, ...buildCliArgTokens(finalizedArgs)];
  const preview = argv.length === 0 ? 'tokenleak' : `tokenleak ${argv.join(' ')}`;

  return {
    type: 'run',
    request: {
      args: { ...finalizedArgs, subcommand },
      argv,
      preview,
      ...describeRequest(finalizedArgs),
      ...overrides,
    },
  };
}

const TAB_RANGE_DAY_COUNTS: Record<TimeRange, number> = {
  '7d': 7, '30d': 30, '90d': 90, '365d': 365,
};

function applySelectedProviders(args: CliArgs, providers: readonly string[]): void {
  if (providers.length === 0) return;
  args['provider'] = providers.join(',');
}

/**
 * Build a TabbedDashboardOptions from user selections.
 * This is the core logic for the "Launch Dashboard" menu item.
 */
export function buildDashboardCommand(
  rangeArgs: CliArgs,
  providers: string[],
  width: number | null,
  noInsights: boolean,
  noColor: boolean,
): InteractiveCommand {
  return {
    type: 'tabbed-dashboard',
    options: buildTabbedDashboardOptions(rangeArgs, providers, width, noInsights, noColor),
  };
}

export function buildJsonCommand(
  rangeArgs: CliArgs,
  providers: string[],
  compare: string | null,
  outputPath: string | null,
  clipboard: boolean,
): InteractiveCommand {
  const args: CliArgs = { format: 'json', ...rangeArgs };
  applySelectedProviders(args, providers);
  if (compare) args['compare'] = compare;
  if (outputPath) args['output'] = outputPath;
  if (clipboard) args['clipboard'] = true;
  return createRunCommand(args);
}

export function buildImageCommand(
  format: 'svg' | 'png',
  theme: string,
  rangeArgs: CliArgs,
  providers: string[],
  compare: string | null,
  outputPath: string,
  shouldOpen: boolean,
  more: boolean,
): InteractiveCommand {
  const args: CliArgs = { format, theme, output: outputPath, open: shouldOpen, more, ...rangeArgs };
  applySelectedProviders(args, providers);
  if (compare) args['compare'] = compare;
  return createRunCommand(args);
}

export function buildWrappedCommand(
  theme: string,
  rangeArgs: CliArgs,
  providers: string[],
  outputPath: string,
  shouldOpen: boolean,
): InteractiveCommand {
  const args: CliArgs = { format: 'wrapped', theme, output: outputPath, open: shouldOpen, ...rangeArgs };
  applySelectedProviders(args, providers);
  return createRunCommand(args);
}

export function buildWrappedLiveCommand(
  rangeArgs: CliArgs,
  providers: string[],
): InteractiveCommand {
  const args: CliArgs = { wrappedLive: true, ...rangeArgs };
  applySelectedProviders(args, providers);
  return createRunCommand(args);
}

export function buildCompareCommand(
  rangeArgs: CliArgs,
  providers: string[],
  compare: string,
  outputPath: string | null,
): InteractiveCommand {
  const args: CliArgs = { format: 'json', compare, ...rangeArgs };
  applySelectedProviders(args, providers);
  if (outputPath) args['output'] = outputPath;
  return createRunCommand(args);
}

export function buildAdvisorCommand(
  format: string,
  rangeArgs: CliArgs,
  providers: string[],
  outputPath: string | null,
  noColor: boolean,
): InteractiveCommand {
  const args: CliArgs = { format, advisor: true, ...rangeArgs };
  if (outputPath) args['output'] = outputPath;
  if (noColor) args['noColor'] = true;
  applySelectedProviders(args, providers);
  return createRunCommand(args);
}

export function buildLiveCommand(
  theme: string,
  rangeArgs: CliArgs,
  providers: string[],
  more: boolean,
): InteractiveCommand {
  const args: CliArgs = { liveServer: true, theme, more, ...rangeArgs };
  applySelectedProviders(args, providers);
  return createRunCommand(args);
}

export function buildExplainCommand(
  date: string,
  format: string,
  providers: string[],
  width: number | null,
  outputPath: string | null,
  noColor: boolean,
): InteractiveCommand {
  const args: CliArgs = { format };
  if (width) args['width'] = width;
  if (outputPath) args['output'] = outputPath;
  if (noColor) args['noColor'] = true;
  applySelectedProviders(args, providers);

  return createSubcommandRunCommand('explain', args, [date], {
    title: 'Explain Day',
    loadingTitle: 'Building explain report',
    loadingDetail: `Analyzing what drove usage on ${date}.`,
  });
}

export function buildFocusCommand(
  format: string,
  rangeArgs: CliArgs,
  providers: string[],
  width: number | null,
  outputPath: string | null,
  noColor: boolean,
): InteractiveCommand {
  const args: CliArgs = { format, ...rangeArgs };
  if (width) args['width'] = width;
  if (outputPath) args['output'] = outputPath;
  if (noColor) args['noColor'] = true;
  applySelectedProviders(args, providers);

  return createSubcommandRunCommand('focus', args, [], {
    title: 'Focus Sessions',
    loadingTitle: 'Ranking focus sessions',
    loadingDetail: 'Finding the deepest work sessions for the selected range.',
  });
}

export function buildCustomRunCommand(args: CliArgs): InteractiveCommand {
  return createRunCommand(args);
}

export function buildListProvidersCommand(): InteractiveCommand {
  return createRunCommand({ listProviders: true });
}

/** Static metadata for the 10-option launcher menu. */
export function getMenuOptionsMeta(): Omit<MenuOption, 'select'>[] {
  return [
    { shortcut: '1', title: 'Launch Dashboard', description: 'guided terminal view', preview: 'tokenleak --days 90' },
    { shortcut: '2', title: 'Export', description: 'JSON, SVG, or PNG (PNG default)', preview: 'tokenleak --format png --output tokenleak.png' },
    { shortcut: '3', title: 'AI Wrapped', description: 'your personal AI coding story card', preview: 'tokenleak --format wrapped --output tokenleak-wrapped.png --open' },
    { shortcut: '4', title: 'Wrapped Live', description: 'interactive AI Wrapped in a browser', preview: 'tokenleak --wrapped-live --days 365' },
    { shortcut: '5', title: 'Compare Periods', description: 'diff current vs previous usage', preview: 'tokenleak --compare auto --format json' },
    { shortcut: '6', title: 'Advisor', description: 'model efficiency recommendations', preview: 'tokenleak --advisor' },
    { shortcut: '7', title: 'Start Live Server', description: 'browser dashboard on localhost', preview: 'tokenleak --live-server --theme dark' },
    { shortcut: '8', title: 'Explain Day', description: 'diagnose one day of usage', preview: 'tokenleak explain 2026-03-10' },
    { shortcut: '9', title: 'Focus Sessions', description: 'rank deep-work sessions', preview: 'tokenleak focus --days 30' },
    { shortcut: '0', title: 'Build Custom Command', description: 'configure flags interactively', preview: 'tokenleak --format terminal --days 90' },
  ];
}
