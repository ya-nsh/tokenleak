import { writeFileSync } from 'node:fs';
import { buildReplayReport, getTodayLocal } from '@tokenleak/core';
import type { ProviderData, ReplayReport } from '@tokenleak/core';
import { startReplayLiveServer } from '@tokenleak/renderers';
import type { ReplayHeatmapEntry, ReplayLiveDataProvider } from '@tokenleak/renderers';
import { loadTokenleakData } from '../data-loader.js';
import { computeDateRange, resolveDayArgument } from '../date-range.js';
import { TokenleakError } from '../errors.js';
import {
  emitProviderWarnings,
  selectAvailableProviders,
  validateProviderSelection,
} from '../providers.js';
import { buildReplayHelpText, renderReplayTerminal } from '../replay.js';
import { CAST_DEFAULT_SPEED, buildReplayCast } from '../replay-cast.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { openFile } from '../sharing/index.js';
import { printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function parseReplayArgs(argv: string[]): {
  date: string;
  cliArgs: Record<string, unknown>;
} {
  let date: string | null = null;
  let dateExplicit = false;

  if (argv.length > 0 && !argv[0]!.startsWith('-')) {
    date = resolveDayArgument('tokenleak replay', argv[0]!);
    dateExplicit = true;
  }

  if (date === null) {
    date = getTodayLocal();
  }

  const cliArgs: Record<string, unknown> = { dateExplicit };
  let index = argv[0]?.startsWith('-') ? 0 : 1;

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
      case '--cursor':
        cliArgs['cursor'] = true;
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
      case '--interactive':
      case '-i':
        cliArgs['interactive'] = true;
        index += 1;
        break;
      case '--noHeatmap':
      case '--no-heatmap':
        cliArgs['noHeatmap'] = true;
        index += 1;
        break;
      case '--open':
        cliArgs['open'] = true;
        index += 1;
        break;
      case '--port': {
        const raw = argv[index + 1];
        if (raw === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        const port = Number(raw);
        if (!Number.isInteger(port) || port < 0 || port > 65_535) {
          throw new TokenleakError(`--port must be an integer between 0 and 65535 (got "${raw}")`);
        }
        cliArgs['port'] = port;
        index += 2;
        break;
      }
      case '--record':
      case '--cast': {
        const raw = argv[index + 1];
        if (raw === undefined) {
          throw new TokenleakError(`${arg} requires an output path`);
        }
        cliArgs['record'] = raw;
        index += 2;
        break;
      }
      case '--speed': {
        const raw = argv[index + 1];
        if (raw === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        const speed = Number(raw);
        if (!Number.isFinite(speed) || speed <= 0 || speed > 10_000) {
          throw new TokenleakError(`--speed must be a positive number ≤ 10000 (got "${raw}")`);
        }
        cliArgs['speed'] = speed;
        index += 2;
        break;
      }
      default:
        throw new TokenleakError(`Unknown replay flag "${arg}"`);
    }
  }

  return { date, cliArgs };
}

/**
 * Group all loaded provider events by date to produce the heatmap entries
 * that drive the in-browser day-navigation strip.
 */
function buildReplayHeatmap(providers: ProviderData[]): ReplayHeatmapEntry[] {
  const byDate = new Map<string, { tokens: number; cost: number; events: number }>();
  for (const provider of providers) {
    const events = provider.events ?? [];
    for (const e of events) {
      const cur = byDate.get(e.date) ?? { tokens: 0, cost: 0, events: 0 };
      cur.tokens += e.totalTokens;
      cur.cost += e.cost;
      cur.events += 1;
      byDate.set(e.date, cur);
    }
  }
  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, tokens: v.tokens, cost: v.cost, events: v.events }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function runReplay(date: string, cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  const interactive = cliArgs['interactive'] === true;
  const recordPath = typeof cliArgs['record'] === 'string' ? cliArgs['record'] : null;
  if (interactive && recordPath !== null) {
    throw new TokenleakError('--interactive and --record are mutually exclusive');
  }
  const format =
    interactive || recordPath ? 'terminal' : resolveTerminalJsonFormat('replay', cliArgs);

  validateProviderSelection(config);

  const replayRange = computeDateRange({ since: date, until: date });
  const available = await selectAvailableProviders(config);

  if (available.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const replayOutput = await loadTokenleakData(available, replayRange);
  emitProviderWarnings(replayOutput.providers);
  const report = buildReplayReport(replayOutput.providers, date);

  if (recordPath !== null) {
    const ignored: string[] = [];
    if (cliArgs['format']) ignored.push('--format');
    if (cliArgs['output']) ignored.push('--output');
    if (cliArgs['width']) ignored.push('--width');
    if (cliArgs['port']) ignored.push('--port');
    if (cliArgs['open']) ignored.push('--open');
    if (ignored.length > 0) {
      process.stderr.write(`Warning: ${ignored.join(', ')} ignored when --record is set.\n`);
    }
    const speed = typeof cliArgs['speed'] === 'number' ? cliArgs['speed'] : CAST_DEFAULT_SPEED;
    const cast = buildReplayCast(report, { speed });
    writeFileSync(recordPath, cast);
    const eventCount = report.events.length;
    process.stderr.write(
      `Wrote asciinema cast to ${recordPath} (${eventCount} frame${eventCount === 1 ? '' : 's'} at ${speed}× — play with: asciinema play ${recordPath})\n`,
    );
    return;
  }

  if (interactive) {
    const ignored: string[] = [];
    if (cliArgs['format']) ignored.push('--format');
    if (cliArgs['output']) ignored.push('--output');
    if (cliArgs['width']) ignored.push('--width');
    if (cliArgs['speed']) ignored.push('--speed');
    if (ignored.length > 0) {
      process.stderr.write(`Warning: ${ignored.join(', ')} ignored when --interactive is set.\n`);
    }

    const rawPort = cliArgs['port'];
    const port = typeof rawPort === 'number' && Number.isFinite(rawPort) ? rawPort : undefined;
    const noHeatmap = cliArgs['noHeatmap'] === true;

    let serverArg: ReplayReport | ReplayLiveDataProvider = report;
    if (!noHeatmap) {
      // Load the last 90 days once. buildReplayReport filters by date, so
      // navigating between days in the browser just calls it again with a
      // different date — no re-load.
      process.stderr.write('Loading 90 days of data for heatmap navigation...\n');
      const heatmapRange = computeDateRange({ days: 90, until: date });
      const heatmapOutput = await loadTokenleakData(available, heatmapRange);
      const heatmapEntries = buildReplayHeatmap(heatmapOutput.providers);

      // If the user didn't pass an explicit date, default the initial view
      // to the most recent day with events instead of "today" — otherwise
      // a quiet today renders 0 flow blocks even though plenty of usable
      // data sits one cell to the left in the heatmap.
      const dateExplicit = cliArgs['dateExplicit'] === true;
      let initialDate = date;
      if (!dateExplicit && heatmapEntries.length > 0) {
        const latestActive = heatmapEntries
          .filter((e) => e.events > 0)
          .reduce<string | null>((acc, e) => (acc === null || e.date > acc ? e.date : acc), null);
        if (latestActive !== null) {
          initialDate = latestActive;
        }
      }
      const initialReport = buildReplayReport(heatmapOutput.providers, initialDate);
      serverArg = {
        heatmap: heatmapEntries,
        initialDate,
        initialReport,
        getReport: (d: string) => {
          const reportForDay = buildReplayReport(heatmapOutput.providers, d);
          return reportForDay.events.length > 0 ? reportForDay : null;
        },
      };
    }

    const { port: actualPort, stop } = await startReplayLiveServer(
      serverArg,
      port !== undefined ? { port } : {},
    );

    if (cliArgs['open'] === true) {
      try {
        await openFile(`http://localhost:${String(actualPort)}/`);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Warning: could not auto-open browser: ${detail}\n`);
      }
    }

    process.stderr.write('Press Ctrl+C to stop the replay server.\n');
    await new Promise<void>((resolve) => {
      const onExit = () => {
        process.stderr.write('\nShutting down replay server...\n');
        stop();
        resolve();
      };
      process.on('SIGINT', onExit);
      process.on('SIGTERM', onExit);
    });
    // The server has stopped; its sockets may linger, so exit explicitly.
    process.exit(0);
  }

  const rendered =
    format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderReplayTerminal(report, config.width);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(rendered + '\n');
  }
}

/** `tokenleak replay [date]`: `argv` is everything after the subcommand name. */
export async function replayCommand(argv: string[]): Promise<void> {
  const { date, cliArgs } = parseReplayArgs(argv);
  if (printInfoFlag(cliArgs, buildReplayHelpText)) return;
  await initPricing();
  await runReplay(date, cliArgs);
}
