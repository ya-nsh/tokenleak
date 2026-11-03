import { VERSION, mergeProviderData } from '@tokenleak/core';
import { computeDateRange } from '../date-range.js';
import { loadProviderDataForRange } from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { writeReportOutput } from '../report-output.js';
import { STATUSLINE_HISTORY_DAYS, buildStatusline, renderStatusline } from '../statusline.js';
import { parseOptimizationArgs, printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

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
  ].join('\n');
}

export async function runStatusline(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig({ ...cliArgs, days: STATUSLINE_HISTORY_DAYS });
  const format = resolveTerminalJsonFormat('statusline', cliArgs);
  const dateRange = computeDateRange({ days: STATUSLINE_HISTORY_DAYS });
  const { providerDataList } = await loadProviderDataForRange(
    { ...config, syncCursor: false },
    dateRange,
  );
  // A status bar has no room for warnings; `tokenleak --verbose` shows them.
  const summary = buildStatusline(mergeProviderData(providerDataList), dateRange.until);
  const rendered =
    format === 'json'
      ? JSON.stringify(summary, null, 2)
      : renderStatusline(summary, { noColor: config.noColor });
  await writeReportOutput(rendered, null);
}

/** `tokenleak statusline`: `argv` is everything after the subcommand name. */
export async function statuslineCommand(argv: string[]): Promise<void> {
  const cliArgs = parseOptimizationArgs(argv);
  if (printInfoFlag(cliArgs, buildStatuslineHelpText)) return;
  await initPricing();
  await runStatusline(cliArgs);
}
