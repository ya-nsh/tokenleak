import { writeFileSync } from 'node:fs';
import { defineCommand } from 'citty';
import {
  DEFAULT_DAYS,
  SCHEMA_VERSION,
  VERSION,
  aggregate,
  buildMoreStats,
  mergeProviderData,
  redactSavingsReportForExport,
} from '@tokenleak/core';
import type { RenderOptions, TokenleakOutput } from '@tokenleak/core';
import {
  JsonRenderer,
  PngRenderer,
  SvgRenderer,
  TerminalRenderer,
  renderAdvisorView,
  renderWrappedPng,
} from '@tokenleak/renderers';
import type { IRenderer } from '@tokenleak/renderers';
import { buildSavings, loadCompareTokenleakData } from '../data-loader.js';
import { computeDateRange } from '../date-range.js';
import { TokenleakError, handleError } from '../errors.js';
import {
  emitProviderWarnings,
  loadProviderDataForRange,
  selectAvailableProviders,
  validateProviderSelection,
  writeProviderList,
} from '../providers.js';
import { FORMAT_VALUES, resolveConfig } from '../report-options.js';
import { copyToClipboard, openFile, uploadToGist } from '../sharing/index.js';
import { buildLiveSiteContent, runLiveSite } from './serve.js';

export function buildHelpText(): string {
  return [
    `tokenleak ${VERSION}`,
    'Visualize AI coding assistant token usage across providers.',
    'Running `tokenleak` with no flags opens the TUI dashboard in a TTY.',
    '',
    'Usage:',
    '  tokenleak [flags]',
    '  tokenleak explain <date> [flags]',
    '  tokenleak focus [flags]',
    '  tokenleak commons <export|inspect|prompt> [flags]',
    '  tokenleak nutrition [flags]',
    '  tokenleak replay [date] [flags]',
    '  tokenleak receipts [flags]',
    '  tokenleak serve [flags]',
    '  tokenleak usage [--json] [--provider claude,codex,copilot]',
    '  tokenleak simulate-routing [flags]',
    '  tokenleak waste [flags]',
    '  tokenleak behavior-diff [flags]',
    '  tokenleak pricing [flags]',
    '  tokenleak statusline [flags]',
    '  tokenleak cursor <command>',
    '',
    'Subcommands:',
    '  explain <date>         Explain what drove usage on one day',
    '  focus                  Rank sessions by deep-work score',
    '  commons                Export or inspect anonymized aggregate usage data',
    '  nutrition              Estimate token cost per local Git outcome signal',
    "  replay [date]          Replay a day's session timeline (defaults to today)",
    '  receipts               Itemized receipt of spend by prompt behavior',
    '  serve                  Serve the dashboard, Wrapped and replay pages locally',
    '  simulate-routing       Estimate savings from model routing changes',
    '  waste                  Savings findings as an evidence table',
    '  behavior-diff          Compare agent/model/project behavior cohorts',
    "  pricing                Show each model's rates and where the price came from",
    '  statusline             One-line spend summary for editor and tmux status bars',
    '  cursor                 Manage Cursor auth and cache sync',
    '',
    'Provider Shortcuts:',
    '  --claude                Only include Claude Code',
    '  --codex                 Only include Codex',
    '  --cursor                Only include Cursor',
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
    '      --advisor           Savings recommendations with the projected monthly bill',
    '      --include-prompts   Keep captured prompt text in JSON exports (omitted by default)',
    '      --clipboard         Copy rendered output to the clipboard',
    '      --open              Open the generated output file',
    '      --upload <target>   Upload rendered output, currently: gist',
    '  -L, --live-server       Alias for `tokenleak serve`, announcing the dashboard',
    '      --wrapped-live      Alias for `tokenleak serve`, announcing AI Wrapped',
    '      --no-color          Disable ANSI colors',
    '      --no-insights       Hide insights in terminal mode',
    '      --verbose           Show every skipped log entry and sync detail (any command)',
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
    '  tokenleak --wrapped-live --days 365',
    '  tokenleak explain 2026-03-10',
    '  tokenleak explain 2026-03-10 --format json',
    '  tokenleak focus --provider codex --days 30',
    '  tokenleak commons export --days 90 --output commons.json',
    '  tokenleak commons prompt --days 90 --clipboard',
    '  tokenleak commons inspect commons.json',
    '  tokenleak nutrition --days 30',
    '  tokenleak nutrition --format json --output nutrition.json',
    '  tokenleak replay',
    '  tokenleak replay 2026-03-10 --format json',
    '  tokenleak replay 2026-03-10 --interactive',
    '  tokenleak simulate-routing --days 30',
    '  tokenleak waste --severity high',
    '  tokenleak behavior-diff --provider claude-code,codex --days 30',
    '',
    'Version:',
    `  CLI ${VERSION}`,
    `  Schema ${SCHEMA_VERSION}`,
    '',
  ].join('\n');
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

/** Main execution function, exported for testing. */
export async function run(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  validateProviderSelection(config);

  if (config.listProviders) {
    await writeProviderList();
    return;
  }

  if (!FORMAT_VALUES.includes(config.format)) {
    throw new TokenleakError(
      `Format "${config.format}" is not supported. Available formats: json, svg, png, terminal, wrapped`,
    );
  }

  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });

  if (config.wrappedLive) {
    process.stderr.write('Detecting available providers...\n');
  }
  const available = await selectAvailableProviders(config);

  if (available.length === 0) {
    throw new TokenleakError('No provider data found');
  }
  if (config.wrappedLive) {
    process.stderr.write(
      `Found ${available.length} provider${available.length > 1 ? 's' : ''}: ${available.map((p) => p.name).join(', ')}\n`,
    );
  }

  // Handle --compare mode.
  if (config.compare) {
    const compareResult = await loadCompareTokenleakData(available, dateRange, config.compare);
    emitProviderWarnings(compareResult.currentData, compareResult.previousData);

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

  if (config.wrappedLive) {
    process.stderr.write(`Loading usage data (${dateRange.since} to ${dateRange.until})...\n`);
  }
  const { providerDataList } = await loadProviderDataForRange(config, dateRange, available);
  emitProviderWarnings(providerDataList);

  if (config.wrappedLive) {
    const totalEvents = providerDataList.reduce((s, p) => s + (p.events?.length ?? 0), 0);
    const totalDays = providerDataList.reduce((s, p) => s + p.daily.length, 0);
    process.stderr.write(`Loaded ${totalDays} day-records, ${totalEvents} events\n`);
  }

  // --advisor is the savings report rendered as model-efficiency advice.
  if (config.advisor) {
    if (config.format !== 'terminal' && config.format !== 'json') {
      throw new TokenleakError(
        `--advisor only supports terminal and json formats, got "${config.format}".`,
      );
    }
    const report = buildSavings(providerDataList, dateRange);
    const rendered =
      config.format === 'json'
        ? JSON.stringify(
            config.includePrompts ? report : redactSavingsReportForExport(report),
            null,
            2,
          )
        : renderAdvisorView(report, { width: config.width, noColor: config.noColor });
    if (config.output) {
      writeFileSync(config.output, rendered);
    } else {
      process.stdout.write(rendered + '\n');
    }
    return;
  }

  // --live-server and --wrapped-live are aliases for `tokenleak serve`, which builds its own
  // output. --format wrapped still takes precedence, as it always has.
  if ((config.liveServer || config.wrappedLive) && config.format !== 'wrapped') {
    const flag = config.liveServer ? '--live-server' : '--wrapped-live';
    const ignoredFlags: string[] = [];
    if (config.output) ignoredFlags.push('--output');
    if (config.clipboard) ignoredFlags.push('--clipboard');
    if (config.open) ignoredFlags.push('--open');
    if (config.upload) ignoredFlags.push('--upload');
    if (ignoredFlags.length > 0) {
      process.stderr.write(`Warning: ${ignoredFlags.join(', ')} ignored in ${flag} mode.\n`);
    }

    const content = buildLiveSiteContent(providerDataList, dateRange, {
      format: config.format,
      theme: config.theme,
      width: config.width,
      showInsights: !config.noInsights,
      noColor: config.noColor,
      output: config.output,
      more: config.more,
    });
    await runLiveSite(content, {
      landing: config.liveServer ? 'dashboard' : 'wrapped',
      open: false,
    });
  }

  // Merge and aggregate
  const mergedDaily = mergeProviderData(providerDataList);
  const stats = aggregate(mergedDaily, dateRange.until, dateRange);

  const needsMore = config.more || config.format === 'wrapped';

  const output: TokenleakOutput = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange,
    providers: providerDataList,
    aggregated: stats,
    more: needsMore ? buildMoreStats(providerDataList, dateRange) : null,
  };

  // Wrapped format — special rendering path
  if (config.format === 'wrapped') {
    const outputPath = config.output ?? 'tokenleak-wrapped.png';
    const wrappedBuffer = await renderWrappedPng(output, { theme: config.theme });
    writeFileSync(outputPath, wrappedBuffer);
    process.stderr.write(`Wrapped PNG written to ${outputPath}\n`);

    if (config.clipboard) {
      process.stderr.write(
        'Clipboard is not supported for binary PNG output. Use --output to save the file.\n',
      );
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
      process.stderr.write(
        `Uploaded to a secret gist (unlisted; anyone with the link can view it): ${url}\n`,
      );
    } else if (config.upload !== undefined) {
      throw new TokenleakError(`Unknown upload target "${config.upload}". Supported: gist`);
    }
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
    includePrompts: config.includePrompts,
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
    process.stderr.write(
      `Uploaded to a secret gist (unlisted; anyone with the link can view it): ${url}\n`,
    );
  } else if (config.upload !== undefined) {
    throw new TokenleakError(`Unknown upload target "${config.upload}". Supported: gist`);
  }
}

export const main = defineCommand({
  meta: {
    name: 'tokenleak',
    version: VERSION,
    description: 'Visualise your AI coding-assistant token usage across providers',
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
    includePrompts: {
      type: 'boolean',
      description: 'Keep captured prompt text in JSON exports',
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
    wrappedLive: {
      type: 'boolean',
      description: 'Start the AI Wrapped presentation in a browser',
      default: false,
    },
    advisor: {
      type: 'boolean',
      description: 'Savings recommendations with the projected monthly bill',
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
      if (args.cursor) cliArgs['cursor'] = true;
      if (args.pi) cliArgs['pi'] = true;
      if (args.openCode) cliArgs['openCode'] = true;
      if (args.allProviders) cliArgs['allProviders'] = true;
      if (args.listProviders) cliArgs['listProviders'] = true;
      if (args.clipboard) cliArgs['clipboard'] = true;
      if (args.open) cliArgs['open'] = true;
      if (args.upload !== undefined) cliArgs['upload'] = args.upload;
      if (args.liveServer) cliArgs['liveServer'] = true;
      if (args.wrappedLive) cliArgs['wrappedLive'] = true;
      if (args.advisor) cliArgs['advisor'] = true;
      if (args.includePrompts) cliArgs['includePrompts'] = true;

      await run(cliArgs);
    } catch (error: unknown) {
      handleError(error);
    }
  },
});
