import { DEFAULT_DAYS, VERSION } from '@tokenleak/core';
import type { DateRange, ProviderData, RenderOptions, ReplayReport } from '@tokenleak/core';
import { initPricing } from '@tokenleak/registry';
import {
  DEFAULT_LIVE_PORT,
  buildReplayLiveDataProvider,
  startLiveSite,
} from '@tokenleak/renderers';
import type { LiveRoute, LiveSiteContent, ReplayLiveDataProvider } from '@tokenleak/renderers';
import { printInfoFlag } from '../args.js';
import { buildTokenleakOutput } from '../data-loader.js';
import { TokenleakError } from '../errors.js';
import { loadOptimizationInput, validateProviderSelection } from '../providers.js';
import { THEME_VALUES, resolveConfig } from '../report-options.js';
import { openFile } from '../sharing/index.js';

const MAX_PORT = 65_535;

const ROUTE_LABELS: Record<LiveRoute, string> = {
  dashboard: 'Dashboard',
  wrapped: 'AI Wrapped',
  replay: 'Replay',
};

export function buildServeHelpText(): string {
  return [
    `tokenleak serve ${VERSION}`,
    'Serve the dashboard, AI Wrapped and replay pages from one local web server.',
    '',
    'Usage:',
    '  tokenleak serve [flags]',
    '',
    'Pages:',
    '  /dashboard              Interactive usage dashboard (was --live-server)',
    '  /wrapped                AI Wrapped presentation (was --wrapped-live)',
    '  /replay?date=YYYY-MM-DD Session replay with a heatmap (was replay --interactive)',
    '',
    'Flags:',
    `      --port <number>     First port to try (default: ${DEFAULT_LIVE_PORT}; the next free one is used)`,
    '      --open              Open the dashboard in your browser',
    '  -t, --theme <theme>     Dashboard theme: dark, light',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --claude, --codex, --cursor, --pi, --open-code, --all-providers',
    '',
    'The server only listens on 127.0.0.1. Press Ctrl+C to stop it.',
    '',
  ].join('\n');
}

/** Parse a `--port` value: an integer from 0 (any free port) to 65535. */
export function parsePort(value: string): number {
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port > MAX_PORT) {
    throw new TokenleakError(`--port must be an integer from 0 to ${MAX_PORT}, got "${value}"`);
  }
  return port;
}

export function parseServeArgs(argv: string[]): Record<string, unknown> {
  const cliArgs: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new TokenleakError(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case '--help':
      case '-h':
        cliArgs['help'] = true;
        break;
      case '--version':
      case '-v':
        cliArgs['version'] = true;
        break;
      case '--port':
        cliArgs['port'] = parsePort(next());
        break;
      case '--open':
        cliArgs['open'] = true;
        break;
      case '--theme':
      case '-t': {
        const theme = next();
        if (!(THEME_VALUES as readonly string[]).includes(theme)) {
          throw new TokenleakError(`--theme must be one of: ${THEME_VALUES.join(', ')}`);
        }
        cliArgs['theme'] = theme;
        break;
      }
      case '--since':
      case '-s':
        cliArgs['since'] = next();
        break;
      case '--until':
      case '-u':
        cliArgs['until'] = next();
        break;
      case '--days':
      case '-d':
        cliArgs['days'] = Number(next());
        break;
      case '--provider':
      case '-p':
        cliArgs['provider'] = next();
        break;
      case '--claude':
        cliArgs['claude'] = true;
        break;
      case '--codex':
        cliArgs['codex'] = true;
        break;
      case '--cursor':
        cliArgs['cursor'] = true;
        break;
      case '--pi':
        cliArgs['pi'] = true;
        break;
      case '--openCode':
      case '--open-code':
        cliArgs['openCode'] = true;
        break;
      case '--allProviders':
      case '--all-providers':
        cliArgs['allProviders'] = true;
        break;
      default:
        throw new TokenleakError(
          `Unknown flag "${arg}". Run \`tokenleak serve --help\` for usage.`,
        );
    }
  }
  return cliArgs;
}

/**
 * Build every live page from one load of provider data. `replay` overrides
 * the default replay page (a heatmap over the whole range, opening on the
 * latest active day).
 */
export function buildLiveSiteContent(
  providers: ProviderData[],
  dateRange: DateRange,
  renderOptions: RenderOptions,
  replay?: ReplayReport | ReplayLiveDataProvider,
): LiveSiteContent {
  const output = buildTokenleakOutput(providers, dateRange, { includeOptimization: true });
  return {
    dashboard: { output, options: renderOptions },
    wrapped: output,
    replay: replay ?? buildReplayLiveDataProvider(providers, null, dateRange.until),
  };
}

export interface LiveSiteLaunch {
  /** The page announced first and opened by `open`. */
  landing: LiveRoute;
  port?: number;
  open: boolean;
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = (): void => {
      process.stderr.write('\nShutting down server...\n');
      resolve();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

/** Serve `content` until Ctrl+C, then exit. */
export async function runLiveSite(
  content: LiveSiteContent,
  launch: LiveSiteLaunch,
): Promise<never> {
  const site = await startLiveSite(content, launch.port !== undefined ? { port: launch.port } : {});
  const routes = site.routes();
  const ordered = [launch.landing, ...routes.filter((route) => route !== launch.landing)];
  const labelWidth = Math.max(...routes.map((route) => ROUTE_LABELS[route].length));
  process.stderr.write(`tokenleak live at ${site.url()}\n`);
  for (const route of ordered) {
    process.stderr.write(`  ${ROUTE_LABELS[route].padEnd(labelWidth)}  ${site.url(route)}\n`);
  }

  if (launch.open) {
    try {
      await openFile(site.url(launch.landing));
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: could not auto-open browser: ${detail}\n`);
    }
  }

  process.stderr.write('Press Ctrl+C to stop the server.\n');
  await waitForShutdownSignal();
  site.stop();
  // The server has stopped; its sockets may linger, so exit explicitly.
  process.exit(0);
}

export async function runServe(cliArgs: Record<string, unknown>): Promise<never> {
  const config = resolveConfig(cliArgs);
  validateProviderSelection(config);
  const { dateRange, providers } = await loadOptimizationInput(config);
  const content = buildLiveSiteContent(providers, dateRange, {
    format: 'terminal',
    theme: config.theme,
    width: config.width,
    showInsights: true,
    noColor: config.noColor,
    output: null,
    more: true,
  });
  return runLiveSite(content, {
    landing: 'dashboard',
    port: typeof cliArgs['port'] === 'number' ? cliArgs['port'] : undefined,
    open: cliArgs['open'] === true,
  });
}

/** `tokenleak serve`: `argv` is everything after the subcommand name. */
export async function serveCommand(argv: string[]): Promise<void> {
  const cliArgs = parseServeArgs(argv);
  if (printInfoFlag(cliArgs, buildServeHelpText)) return;
  await initPricing();
  await runServe(cliArgs);
}
