import { DEFAULT_DAYS } from '@tokenleak/core';
import type { DateRange } from '@tokenleak/core';
import type { TimeRange } from '@tokenleak/renderers';
import type { CliArgs, InteractiveRunRequest, TabbedDashboardOptions } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(dateStr: string): boolean {
  if (!DATE_FORMAT.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

export function computeDateRange(args: {
  since?: string;
  until?: string;
  days?: number;
}): DateRange {
  const until = args.until ?? new Date().toISOString().slice(0, 10);
  let since: string;
  if (args.since) {
    since = args.since;
  } else {
    const daysBack = args.days ?? DEFAULT_DAYS;
    const d = new Date(until);
    d.setDate(d.getDate() - daysBack);
    since = d.toISOString().slice(0, 10);
  }
  return { since, until };
}

const CLI_FLAG_ORDER = [
  'format', 'theme', 'since', 'until', 'days', 'output', 'width',
  'provider', 'compare', 'upload', 'claude', 'codex', 'pi', 'openCode',
  'allProviders', 'listProviders', 'more', 'clipboard', 'open',
  'liveServer', 'wrappedLive', 'noColor', 'noInsights', 'advisor',
] as const;

const CLI_FLAG_NAMES: Record<string, string> = {
  format: '--format', theme: '--theme', since: '--since', until: '--until',
  days: '--days', output: '--output', width: '--width', provider: '--provider',
  compare: '--compare', upload: '--upload', claude: '--claude', codex: '--codex',
  pi: '--pi', openCode: '--open-code', allProviders: '--all-providers',
  listProviders: '--list-providers', more: '--more', clipboard: '--clipboard',
  open: '--open', liveServer: '--live-server', wrappedLive: '--wrapped-live',
  noColor: '--no-color', noInsights: '--no-insights', advisor: '--advisor',
};

export function buildCliArgTokens(cliArgs: CliArgs): string[] {
  const tokens: string[] = [];
  for (const key of CLI_FLAG_ORDER) {
    const value = cliArgs[key];
    if (value === undefined || value === false || value === null) continue;
    const flag = CLI_FLAG_NAMES[key];
    if (!flag) continue;
    tokens.push(flag);
    if (value !== true) tokens.push(String(value));
  }
  return tokens;
}

export function buildCliPreview(cliArgs: CliArgs): string {
  const tokens = buildCliArgTokens(cliArgs);
  return tokens.length === 0 ? 'tokenleak' : `tokenleak ${tokens.join(' ')}`;
}

export function shouldStartInteractiveCli(
  argv: string[],
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
): boolean {
  return argv.length === 0 && stdinIsTTY && stdoutIsTTY;
}

export function clampScrollOffset(offset: number, totalLines: number, viewportHeight: number): number {
  const maxOffset = Math.max(0, totalLines - Math.max(1, viewportHeight));
  return Math.min(Math.max(0, offset), maxOffset);
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function describeRequest(args: CliArgs): Pick<InteractiveRunRequest, 'title' | 'loadingTitle' | 'loadingDetail' | 'executionMode'> {
  const output = typeof args['output'] === 'string' ? args['output'] : null;

  if (args['liveServer']) {
    return { title: 'Live Dashboard', loadingTitle: 'Starting live dashboard', loadingDetail: 'Launching the local server. Press Ctrl-C in the live view to stop it, then you will return here.', executionMode: 'inherit' };
  }
  if (args['wrappedLive']) {
    return { title: 'Wrapped Live', loadingTitle: 'Starting wrapped live presentation', loadingDetail: 'Loading usage data and launching the local server. Press Ctrl-C to stop it, then you will return here.', executionMode: 'inherit' };
  }
  if (args['listProviders']) {
    return { title: 'Provider Registry', loadingTitle: 'Loading provider registry', loadingDetail: 'Checking registered providers and current availability.', executionMode: 'capture' };
  }
  if (args['compare']) {
    return { title: 'Compare Report', loadingTitle: 'Building compare report', loadingDetail: output ? `Computing period deltas and writing the report to ${output}.` : 'Computing period deltas for the current and previous windows.', executionMode: 'capture' };
  }

  switch (args['format']) {
    case 'json':
      return { title: 'JSON Export', loadingTitle: 'Generating JSON report', loadingDetail: output ? `Collecting token usage and writing JSON to ${output}.` : 'Collecting token usage and building structured JSON output.', executionMode: 'capture' };
    case 'svg':
      return { title: 'SVG Export', loadingTitle: 'Rendering SVG', loadingDetail: output ? `Rendering a vector card and writing it to ${output}.` : 'Rendering a vector card from your usage data.', executionMode: 'capture' };
    case 'png':
      return { title: 'PNG Export', loadingTitle: 'Rendering PNG', loadingDetail: output ? `Rendering the PNG card and writing it to ${output}. This can take a few seconds.` : 'Rendering the PNG card. This can take a few seconds.', executionMode: 'capture' };
    default:
      return { title: 'Terminal Dashboard', loadingTitle: 'Generating terminal dashboard', loadingDetail: 'Reading provider logs and aggregating token usage.', executionMode: 'capture' };
  }
}

export function finalizeCliArgs(args: CliArgs): CliArgs {
  const finalized: CliArgs = { ...args };
  const format = finalized['format'];

  if (finalized['compare'] && (format === 'png' || format === 'svg')) {
    finalized['more'] = true;
  }

  if (finalized['open'] && finalized['output'] === undefined && typeof format === 'string') {
    if (format === 'png' || format === 'svg' || format === 'json') {
      finalized['output'] = `tokenleak.${format}`;
    } else {
      delete finalized['open'];
    }
  }

  if (format === 'png') {
    delete finalized['clipboard'];
    delete finalized['upload'];
  }

  return finalized;
}

function inferDashboardTimeRange(rangeArgs: CliArgs): TimeRange {
  const days = typeof rangeArgs['days'] === 'number' ? rangeArgs['days'] : null;
  if (days !== null) {
    if (days <= 7) return '7d';
    if (days <= 30) return '30d';
    if (days <= 90) return '90d';
    return '365d';
  }

  const since = typeof rangeArgs['since'] === 'string' ? rangeArgs['since'].trim() : '';
  if (!since) return '30d';

  const rawUntil = typeof rangeArgs['until'] === 'string' ? rangeArgs['until'].trim() : '';
  const until = rawUntil || new Date().toISOString().slice(0, 10);
  const sinceMs = Date.parse(`${since}T00:00:00.000Z`);
  const untilMs = Date.parse(`${until}T00:00:00.000Z`);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || sinceMs > untilMs) {
    return '30d';
  }

  const spanDays = Math.max(1, Math.ceil((untilMs - sinceMs) / DAY_MS));
  if (spanDays <= 7) return '7d';
  if (spanDays <= 30) return '30d';
  if (spanDays <= 90) return '90d';
  return '365d';
}

export function buildTabbedDashboardOptions(
  rangeArgs: CliArgs,
  providers: readonly string[],
  width: number | null,
  noInsights: boolean,
  noColor: boolean,
  compare: string | null = 'auto',
): TabbedDashboardOptions {
  const options: TabbedDashboardOptions = {
    initialTimeRange: inferDashboardTimeRange(rangeArgs),
    noColor,
    noInsights,
  };

  const rawSince = typeof rangeArgs['since'] === 'string' ? rangeArgs['since'].trim() : '';
  const rawUntil = typeof rangeArgs['until'] === 'string' ? rangeArgs['until'].trim() : '';
  const since = rawSince || undefined;
  const until = rawUntil || undefined;
  if (since) {
    options.initialRange = computeDateRange({ since, until });
    options.until = options.initialRange.until;
  } else if (until) {
    options.until = computeDateRange({ until }).until;
  }
  if (providers.length > 0) {
    options.providerNames = [...providers];
  }
  if (width !== null) {
    options.width = width;
  }
  if (compare) {
    options.compare = compare;
  }

  return options;
}
