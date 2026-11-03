import { writeFileSync } from 'node:fs';
import { buildReplayReport, getTodayLocal } from '@tokenleak/core';
import { buildReplayLiveDataProvider } from '@tokenleak/renderers';
import { loadTokenleakData } from '../data-loader.js';
import { computeDateRange, resolveDayArgument } from '../date-range.js';
import { TokenleakError } from '../errors.js';
import {
  emitProviderWarnings,
  loadProviderDataForRange,
  selectAvailableProviders,
  validateProviderSelection,
} from '../providers.js';
import { buildReplayHelpText, renderReplayTerminal } from '../replay.js';
import { CAST_DEFAULT_SPEED, buildReplayCast } from '../replay-cast.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';
import { buildLiveSiteContent, parsePort, runLiveSite } from './serve.js';

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
        cliArgs['port'] = parsePort(raw);
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

/** Days of history behind the interactive replay heatmap. */
const REPLAY_HEATMAP_DAYS = 90;

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
    // `replay --interactive` is an alias for `tokenleak serve` opening on the replay page. The
    // heatmap covers the days up to `date` from one load; buildReplayReport filters by date, so
    // switching days in the browser never reloads. --no-heatmap loads only `date`.
    const noHeatmap = cliArgs['noHeatmap'] === true;
    const range = noHeatmap
      ? replayRange
      : computeDateRange({ days: REPLAY_HEATMAP_DAYS, until: date });
    if (!noHeatmap) {
      process.stderr.write(
        `Loading ${REPLAY_HEATMAP_DAYS} days of data for heatmap navigation...\n`,
      );
    }
    const { providerDataList } = await loadProviderDataForRange(config, range, available);
    emitProviderWarnings(providerDataList);
    // Without an explicit date, open on the latest active day rather than a quiet today.
    const replay = noHeatmap
      ? buildReplayReport(providerDataList, date)
      : buildReplayLiveDataProvider(
          providerDataList,
          cliArgs['dateExplicit'] === true ? date : null,
          date,
        );
    const content = buildLiveSiteContent(
      providerDataList,
      range,
      {
        format: 'terminal',
        theme: config.theme,
        width: config.width,
        showInsights: true,
        noColor: config.noColor,
        output: null,
        more: true,
      },
      replay,
    );
    await runLiveSite(content, { landing: 'replay', port, open: cliArgs['open'] === true });
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
