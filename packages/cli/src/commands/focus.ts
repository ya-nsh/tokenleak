import { writeFileSync } from 'node:fs';
import { defineCommand, runMain } from 'citty';
import { DEFAULT_DAYS, VERSION, buildFocusReport, formatTokenCount } from '@tokenleak/core';
import type { FocusReport } from '@tokenleak/core';
import { bold, bold256, colorize256, dim } from '@tokenleak/renderers';
import { loadConfig } from '../config.js';
import { loadEnvOverrides } from '../env.js';
import { TokenleakError, handleError } from '../errors.js';
import { defaultTerminalWidth, shouldUseColor } from '../output-mode.js';
import { loadProviderData, writeProviderList } from '../providers.js';
import type { ProviderLoadConfig } from '../providers.js';
import { inferFormatFromPath } from '../report-options.js';
import { infoFlagsFromArgv, printInfoFlag, validateCommandFlags } from '../args.js';
import { initPricing } from '@tokenleak/registry';

const FOCUS_FORMAT_VALUES = ['json', 'terminal'] as const;

interface FocusConfig extends ProviderLoadConfig {
  format: (typeof FOCUS_FORMAT_VALUES)[number];
  output: string | null;
  width: number;
  noColor: boolean;
  listProviders: boolean;
}

export function buildFocusHelpText(): string {
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
    '      --cursor           Only include Cursor',
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

export function resolveFocusConfig(cliArgs: Record<string, unknown>): FocusConfig {
  const fileConfig = loadConfig();
  const envConfig = loadEnvOverrides();

  const merged: FocusConfig = {
    format: 'terminal',
    since: undefined,
    until: undefined,
    days: DEFAULT_DAYS,
    output: null,
    width: defaultTerminalWidth(),
    noColor: !shouldUseColor(),
    provider: undefined,
    claude: false,
    codex: false,
    cursor: false,
    pi: false,
    openCode: false,
    allProviders: false,
    listProviders: false,
  };

  if (
    fileConfig.format &&
    FOCUS_FORMAT_VALUES.includes(fileConfig.format as (typeof FOCUS_FORMAT_VALUES)[number])
  ) {
    merged.format = fileConfig.format as (typeof FOCUS_FORMAT_VALUES)[number];
  }
  if (fileConfig.days !== undefined) merged.days = fileConfig.days;
  if (fileConfig.width !== undefined) merged.width = fileConfig.width;
  if (fileConfig.noColor !== undefined) merged.noColor = fileConfig.noColor;

  if (
    envConfig.format &&
    FOCUS_FORMAT_VALUES.includes(envConfig.format as (typeof FOCUS_FORMAT_VALUES)[number])
  ) {
    merged.format = envConfig.format as (typeof FOCUS_FORMAT_VALUES)[number];
  }
  if (envConfig.days !== undefined) merged.days = envConfig.days;

  const result: FocusConfig = { ...merged };

  if (cliArgs['format'] !== undefined) {
    const format = cliArgs['format'] as string;
    if (!FOCUS_FORMAT_VALUES.includes(format as (typeof FOCUS_FORMAT_VALUES)[number])) {
      throw new TokenleakError(
        `Unsupported focus format: "${format}". Available: ${FOCUS_FORMAT_VALUES.join(', ')}`,
      );
    }
    result.format = format as (typeof FOCUS_FORMAT_VALUES)[number];
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
  } else if (result.output !== null && !shouldUseColor({ isTTY: false })) {
    // A file is never a terminal: keep escape codes out of saved reports.
    result.noColor = true;
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
  if (cliArgs['cursor'] !== undefined) {
    result.cursor = cliArgs['cursor'] as boolean;
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
  return `${formatTokenCount(tokensPerHour)}/h`;
}

// ─── Focus report color helpers ───────────────────────────────────────

const PROVIDER_COLORS: Record<string, number> = {
  'claude-code': 179, // amber
  codex: 71, // green
  cursor: 78, // spring green
  codebuff: 33,
  droid: 208,
  kimi: 244,
  kilo: 214,
  mux: 205,
  crush: 196,
  goose: 37,
  antigravity: 99,
  zed: 38,
  kiro: 63,
  trae: 44,
  synthetic: 42,
  hermes: 35,
  pi: 73, // cyan/teal
  'open-code': 68, // indigo/steel blue
};

export function colorScore(value: number, text: string, noColor: boolean): string {
  if (value >= 8) return colorize256(text, 71, noColor); // green
  if (value >= 5) return colorize256(text, 179, noColor); // yellow/amber
  if (value >= 3) return colorize256(text, 73, noColor); // cyan
  return dim(text, noColor);
}

export function colorDuration(durationMs: number | null, text: string, noColor: boolean): string {
  if (durationMs && durationMs > 3_600_000) return bold256(text, 255, noColor); // bold white for >1h
  return text;
}

export function colorDensity(tokensPerHour: number, text: string, noColor: boolean): string {
  if (tokensPerHour > 30_000) return colorize256(text, 71, noColor); // green
  if (tokensPerHour > 15_000) return colorize256(text, 179, noColor); // yellow
  return dim(text, noColor);
}

export function colorProvider(provider: string, text: string, noColor: boolean): string {
  const code = PROVIDER_COLORS[provider] ?? 246; // gray fallback
  return colorize256(text, code, noColor);
}

export function colorStreak(streak: number, text: string, noColor: boolean): string {
  if (streak >= 3) return colorize256(text, 208, noColor); // orange/fire
  return text;
}

// ─── Focus report renderer ───────────────────────────────────────────

function truncateFocus(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) return value;
  if (maxWidth <= 1) return value.slice(0, maxWidth);
  return `${value.slice(0, maxWidth - 1)}\u2026`;
}

export function renderFocusReport(report: FocusReport, width: number, noColor: boolean): string {
  const termWidth = Math.max(60, width || 80);

  const lines: string[] = [
    bold('Tokenleak Focus', noColor),
    report.method,
    '',
    `${report.entries.length} sessions ranked by deep-work score.`,
  ];

  if (report.entries.length === 0) {
    lines.push('', 'No session data available.');
    return lines.join('\n');
  }

  // --- STEP 1: Build all cell values, measure natural widths ---
  const headers = ['Score', 'Dur', 'Density', 'Stk', 'Provider', 'Label'];
  const rows: string[][] = report.entries.map((entry) => [
    entry.score.toFixed(1),
    formatFocusDuration(entry.durationMs),
    formatFocusDensity(entry.tokensPerHour),
    `${entry.streak}d`,
    entry.provider,
    entry.label,
  ]);

  const colCount = headers.length;
  const naturalWidths: number[] = headers.map((h) => h.length);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      naturalWidths[c] = Math.max(naturalWidths[c]!, row[c]!.length);
    }
  }
  // Add 1-char padding on each side
  const colWidths = naturalWidths.map((w) => w + 2);

  // --- STEP 2: Enforce max total width ---
  // Total = outer borders (2 chars: │…│) + inner separators (colCount-1) + sum(colWidths)
  const chrome = 2 + (colCount - 1); // │col│col│col│ → 2 outer + (n-1) inner
  const maxContentWidth = termWidth - chrome;
  let totalContent = colWidths.reduce((sum, w) => sum + w, 0);

  if (totalContent > maxContentWidth) {
    // Shrink last column (Label) first, then work leftward
    const surplus = totalContent - maxContentWidth;
    const labelIdx = colCount - 1;
    const minLabelWidth = headers[labelIdx]!.length + 2;
    const labelShrink = Math.min(surplus, colWidths[labelIdx]! - minLabelWidth);
    colWidths[labelIdx]! -= labelShrink;
    totalContent -= labelShrink;

    // If still over, shrink remaining columns right-to-left
    if (totalContent > maxContentWidth) {
      for (let c = colCount - 2; c >= 0 && totalContent > maxContentWidth; c--) {
        const minW = headers[c]!.length + 2;
        const shrink = Math.min(totalContent - maxContentWidth, colWidths[c]! - minW);
        colWidths[c]! -= shrink;
        totalContent -= shrink;
      }
    }
  }

  // --- STEP 3: Render the table ---
  const border = (ch: string) => colorize256(ch, 245, noColor);

  function hLine(left: string, mid: string, right: string): string {
    return (
      border(left) +
      colWidths.map((w) => border('\u2500'.repeat(w))).join(border(mid)) +
      border(right)
    );
  }

  function coloredDataRow(entry: (typeof report.entries)[number], cells: string[]): string {
    const padded = cells.map((cell, c) => {
      const w = colWidths[c]!;
      const inner = w - 2;
      const truncated = truncateFocus(cell, inner);
      const paddedText = truncated.padEnd(inner);
      // Colorize based on column
      switch (c) {
        case 0:
          return ` ${colorScore(entry.score, paddedText, noColor)} `;
        case 1:
          return ` ${colorDuration(entry.durationMs, paddedText, noColor)} `;
        case 2:
          return ` ${colorDensity(entry.tokensPerHour, paddedText, noColor)} `;
        case 3:
          return ` ${colorStreak(entry.streak, paddedText, noColor)} `;
        case 4:
          return ` ${colorProvider(entry.provider, paddedText, noColor)} `;
        default:
          return ` ${paddedText} `;
      }
    });
    return border('\u2502') + padded.join(border('\u2502')) + border('\u2502');
  }

  lines.push('');
  lines.push(hLine('\u250C', '\u252C', '\u2510'));
  // Bold header — pad plain text first, then bold the padded cell
  const headerCells = headers.map((h, c) => {
    const inner = colWidths[c]! - 2;
    const padded = truncateFocus(h, inner).padEnd(inner);
    return ` ${bold(padded, noColor)} `;
  });
  lines.push(border('\u2502') + headerCells.join(border('\u2502')) + border('\u2502'));
  lines.push(hLine('\u251C', '\u253C', '\u2524'));

  for (let i = 0; i < report.entries.length; i++) {
    const entry = report.entries[i]!;
    if (i > 0) {
      lines.push(hLine('\u251C', '\u253C', '\u2524'));
    }
    lines.push(coloredDataRow(entry, rows[i]!));
  }

  lines.push(hLine('\u2514', '\u2534', '\u2518'));

  // Legend
  lines.push('');
  lines.push(dim('Stk = project streak (consecutive days)  Density = tokens per hour', noColor));

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
    await writeProviderList();
    return;
  }

  const { providerDataList } = await loadProviderData(config);
  const events = providerDataList.flatMap((provider) => provider.events ?? []);

  if (events.length === 0) {
    const emptyMsg =
      config.format === 'json'
        ? JSON.stringify({ method: 'No event data', entries: [] }, null, 2)
        : renderFocusReport(
            { method: 'No event-level data found for focus analysis.', entries: [] },
            config.width,
            config.noColor,
          );
    if (config.output) {
      writeFileSync(config.output, emptyMsg);
    } else {
      process.stdout.write(`${emptyMsg}\n`);
    }
    return;
  }

  const report = buildFocusReport(events);

  const rendered =
    config.format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderFocusReport(report, config.width, config.noColor);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

export const focusMain = defineCommand({
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
    cursor: {
      type: 'boolean',
      description: 'Shortcut for --provider cursor',
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
      if (args.cursor) cliArgs['cursor'] = true;
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

/** `tokenleak focus`: `argv` is everything after the subcommand name. */
export async function focusCommand(argv: string[]): Promise<void> {
  // citty reads process.argv, so hand it only this command's flags.
  process.argv = [...process.argv.slice(0, 2), ...argv];
  if (printInfoFlag(infoFlagsFromArgv(argv), buildFocusHelpText)) return;
  await validateCommandFlags(focusMain, argv, 'tokenleak focus');
  await initPricing();
  await runMain(focusMain);
}
