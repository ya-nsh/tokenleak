import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { VERSION, getTokenleakCacheDir, mergeProviderData } from '@tokenleak/core';
import type { DateRange } from '@tokenleak/core';
import { initPricing } from '@tokenleak/registry';
import { computeDateRange } from '../date-range.js';
import { loadProviderDataForRange } from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { writeReportOutput } from '../report-output.js';
import { STATUSLINE_HISTORY_DAYS, buildStatusline, renderStatusline } from '../statusline.js';
import type { StatuslineSummary } from '../statusline.js';
import {
  REFRESH_TOKEN_ENV,
  SNAPSHOT_SWITCH_ENV,
  STATUSLINE_SNAPSHOT_VERSION,
  acquireRefreshLock,
  decideSnapshotUse,
  newRefreshToken,
  readStatuslineSnapshot,
  releaseRefreshLock,
  statuslineSnapshotKey,
  statuslineSnapshotPaths,
  writeStatuslineSnapshot,
} from '../statusline-snapshot.js';
import type { SnapshotPaths, StatuslineSnapshot } from '../statusline-snapshot.js';
import { parseOptimizationArgs, printInfoFlag } from '../args.js';

export function buildStatuslineHelpText(): string {
  return [
    `tokenleak statusline ${VERSION}`,
    "One line of today's spend, the last 7 days, and your streak:",
    '  $42.10 today (120M) · $836 7d · 14d streak',
    '',
    'Usage:',
    '  tokenleak statusline [flags]',
    '',
    'Claude Code (~/.claude/settings.json):',
    '  { "statusLine": { "type": "command", "command": "tokenleak statusline" } }',
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal (default), json',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --no-color          Disable ANSI colors (also off when piped)',
    '',
    'The last line is printed at once and refreshed in the background, so it can',
    `be one refresh behind. ${SNAPSHOT_SWITCH_ENV}=0 computes it on every call.`,
    '',
  ].join('\n');
}

type StatuslineConfig = ReturnType<typeof resolveConfig>;

export interface StatuslineDeps {
  now: () => number;
  env: NodeJS.ProcessEnv;
  snapshotDirectory: () => string;
  computeSummary: (config: StatuslineConfig, dateRange: DateRange) => Promise<StatuslineSummary>;
  /** Start a detached `tokenleak statusline` that refreshes the snapshot; false if it could not start. */
  startBackgroundRefresh: (token: string) => boolean;
  write: (rendered: string) => Promise<void>;
}

async function computeSummaryFromLogs(config: StatuslineConfig, dateRange: DateRange): Promise<StatuslineSummary> {
  await initPricing();
  const { providerDataList } = await loadProviderDataForRange({ ...config, syncCursor: false }, dateRange);
  // A status bar has no room for warnings; `tokenleak --verbose` shows them.
  return buildStatusline(mergeProviderData(providerDataList), dateRange.until);
}

/** Re-run this same command, detached and silent, with the refresh token in its environment. */
function spawnBackgroundRefresh(token: string): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    const child = spawn(process.execPath, process.argv.slice(1), {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [REFRESH_TOKEN_ENV]: token },
    });
    child.on('error', () => {
      // The lock it was started under expires on its own.
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const defaultDeps: StatuslineDeps = {
  now: () => Date.now(),
  env: process.env,
  snapshotDirectory: () => join(getTokenleakCacheDir(), 'statusline'),
  computeSummary: computeSummaryFromLogs,
  startBackgroundRefresh: spawnBackgroundRefresh,
  write: (rendered) => writeReportOutput(rendered, null),
};

/** The provider choice the summary depends on, after config-file and environment defaults. */
function providerSelection(config: StatuslineConfig): unknown {
  const { provider, claude, codex, cursor, pi, openCode, allProviders } = config;
  return { provider: provider ?? null, claude, codex, cursor, pi, openCode, allProviders };
}

async function computeSnapshot(
  config: StatuslineConfig,
  dateRange: DateRange,
  key: string,
  deps: StatuslineDeps,
): Promise<StatuslineSnapshot> {
  const summary = await deps.computeSummary(config, dateRange);
  return {
    version: STATUSLINE_SNAPSHOT_VERSION,
    key,
    today: dateRange.until,
    computedAt: deps.now(),
    summary,
  };
}

/** Start one background refresh unless another is already running. */
function requestRefresh(paths: SnapshotPaths, deps: StatuslineDeps): void {
  const token = newRefreshToken();
  if (!acquireRefreshLock(paths.lock, token, deps.now())) return;
  if (!deps.startBackgroundRefresh(token)) releaseRefreshLock(paths.lock, token);
}

function render(snapshot: StatuslineSnapshot, format: 'json' | 'terminal', noColor: boolean): string {
  return format === 'json'
    ? JSON.stringify({ ...snapshot.summary, updatedAt: new Date(snapshot.computedAt).toISOString() }, null, 2)
    : renderStatusline(snapshot.summary, { noColor });
}

export async function runStatusline(cliArgs: Record<string, unknown>, deps: StatuslineDeps = defaultDeps): Promise<void> {
  const config = resolveConfig({ ...cliArgs, days: STATUSLINE_HISTORY_DAYS });
  const format = resolveTerminalJsonFormat('statusline', cliArgs);
  const dateRange = computeDateRange({ days: STATUSLINE_HISTORY_DAYS });
  const key = statuslineSnapshotKey(providerSelection(config), deps.env);
  const paths = statuslineSnapshotPaths(deps.snapshotDirectory(), key);

  const refreshToken = deps.env[REFRESH_TOKEN_ENV];
  if (refreshToken) {
    // A background refresh prints nothing. If it fails, its lock stays until
    // it goes stale, which spaces out the retries.
    writeStatuslineSnapshot(paths.snapshot, await computeSnapshot(config, dateRange, key, deps));
    releaseRefreshLock(paths.lock, refreshToken);
    return;
  }

  const cached = deps.env[SNAPSHOT_SWITCH_ENV] !== '0';
  const decision = cached
    ? decideSnapshotUse(readStatuslineSnapshot(paths.snapshot, key), dateRange.until, deps.now())
    : ({ kind: 'compute' } as const);

  let snapshot: StatuslineSnapshot;
  if (decision.kind === 'serve') {
    snapshot = decision.snapshot;
    if (decision.refresh) requestRefresh(paths, deps);
  } else {
    snapshot = await computeSnapshot(config, dateRange, key, deps);
    if (cached) writeStatuslineSnapshot(paths.snapshot, snapshot);
  }
  await deps.write(render(snapshot, format, config.noColor));
}

/** `tokenleak statusline`: `argv` is everything after the subcommand name. */
export async function statuslineCommand(argv: string[]): Promise<void> {
  const cliArgs = parseOptimizationArgs(argv);
  if (printInfoFlag(cliArgs, buildStatuslineHelpText)) return;
  await runStatusline(cliArgs);
}
