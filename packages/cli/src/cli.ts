#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { writeFileSync } from 'node:fs';
import {
  VERSION,
  DEFAULT_DAYS,
  SCHEMA_VERSION,
  aggregate,
  mergeProviderData,
  buildCompareOutput,
  parseCompareRange,
  computePreviousPeriod,
} from '@tokenleak/core';
import type {
  DateRange,
  RenderOptions,
  TokenleakOutput,
  CompareOutput,
  ProviderData,
} from '@tokenleak/core';
import {
  ProviderRegistry,
  ClaudeCodeProvider,
  CodexProvider,
  OpenCodeProvider,
} from '@tokenleak/registry';
import type { IProvider } from '@tokenleak/registry';
import { JsonRenderer } from '@tokenleak/renderers';
import type { IRenderer } from '@tokenleak/renderers';

import { loadConfig } from './config.js';
import { loadEnvOverrides } from './env.js';
import { TokenleakError, handleError } from './errors.js';
import { copyToClipboard, openFile, uploadToGist } from './sharing/index.js';

const FORMAT_VALUES = ['json', 'svg', 'png', 'terminal'] as const;
const THEME_VALUES = ['dark', 'light'] as const;

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

/** Compute the date range from CLI flags. */
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
  compare?: string;
  provider?: string;
  clipboard: boolean;
  open: boolean;
  upload?: string;
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
    clipboard: boolean;
    open: boolean;
  } = {
    format: 'terminal',
    theme: 'dark',
    days: DEFAULT_DAYS,
    output: null,
    width: 80,
    noColor: false,
    noInsights: false,
    clipboard: false,
    open: false,
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
  if (cliArgs['compare'] !== undefined) {
    result.compare = cliArgs['compare'] as string;
  }
  if (cliArgs['provider'] !== undefined) {
    result.provider = cliArgs['provider'] as string;
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

  return result;
}

/** Get a renderer for the given format. */
function getRenderer(format: string): IRenderer {
  switch (format) {
    case 'json':
      return new JsonRenderer();
    default:
      throw new TokenleakError(
        `Format "${format}" is not yet supported. Available formats: json`,
      );
  }
}

/**
 * Load provider data for a date range and aggregate.
 * Shared helper for normal and compare modes.
 */
async function loadAndAggregate(
  range: DateRange,
  providers: IProvider[],
): Promise<{ data: ProviderData[]; stats: ReturnType<typeof aggregate> }> {
  const results = await Promise.all(
    providers.map(async (p) => {
      try {
        return await p.load(range);
      } catch {
        return null;
      }
    }),
  );
  const data = results.filter((r): r is ProviderData => r !== null);
  const merged = data.length > 0 ? mergeProviderData(data) : [];
  const stats = aggregate(merged, range.until);
  return { data, stats };
}

/**
 * Run compare mode: load data for two periods, compute deltas.
 * If compareStr is a range "YYYY-MM-DD..YYYY-MM-DD", use it as the previous period.
 * If compareStr is "auto" or "true", compute the previous period automatically.
 */
async function runCompare(
  compareStr: string,
  currentRange: DateRange,
  _registry: ProviderRegistry,
  available: IProvider[],
): Promise<CompareOutput> {
  let previousRange: DateRange;

  if (compareStr === 'auto' || compareStr === 'true' || compareStr === '') {
    previousRange = computePreviousPeriod(currentRange);
  } else {
    const parsed = parseCompareRange(compareStr);
    if (!parsed) {
      throw new TokenleakError(
        `Invalid --compare format: "${compareStr}". Use YYYY-MM-DD..YYYY-MM-DD or "auto".`,
      );
    }
    previousRange = parsed;
  }

  const [currentResult, previousResult] = await Promise.all([
    loadAndAggregate(currentRange, available),
    loadAndAggregate(previousRange, available),
  ]);

  return buildCompareOutput(
    { range: currentRange, stats: currentResult.stats },
    { range: previousRange, stats: previousResult.stats },
  );
}

/** Main execution function, exported for testing. */
export async function run(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);

  // Build date range
  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });

  // Register providers
  const registry = new ProviderRegistry();
  registry.register(new ClaudeCodeProvider());
  registry.register(new CodexProvider());
  registry.register(new OpenCodeProvider());

  // Get available providers
  let available = await registry.getAvailable();

  // Filter by --provider if set
  if (config.provider) {
    const requested = new Set(
      config.provider.split(',').map((s) => s.trim().toLowerCase()),
    );
    available = available.filter(
      (p) =>
        requested.has(p.name.toLowerCase()) ||
        requested.has(p.displayName.toLowerCase()),
    );
  }

  if (available.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  // Handle --compare mode
  if (config.compare) {
    const compareOutput = await runCompare(
      config.compare,
      dateRange,
      registry,
      available,
    );
    const rendered = JSON.stringify(compareOutput, null, 2);
    if (config.output) {
      writeFileSync(config.output, rendered);
    } else {
      process.stdout.write(rendered + '\n');
    }
    return;
  }

  // Load data from available providers
  const results = await Promise.all(
    available.map(async (p) => {
      try {
        return await p.load(dateRange);
      } catch {
        return null;
      }
    }),
  );

  const providerDataList: ProviderData[] = results.filter(
    (r): r is ProviderData => r !== null,
  );

  if (providerDataList.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  // Merge and aggregate
  const mergedDaily = mergeProviderData(providerDataList);
  const stats = aggregate(mergedDaily, dateRange.until);

  const output: TokenleakOutput = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange,
    providers: providerDataList,
    aggregated: stats,
  };

  // Render
  const renderer = getRenderer(config.format);
  const renderOptions: RenderOptions = {
    format: config.format,
    theme: config.theme,
    width: config.width,
    showInsights: !config.noInsights,
    noColor: config.noColor,
    output: config.output,
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
      description: 'Output format: json, svg, png, terminal',
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
    compare: {
      type: 'string',
      description: 'Compare two date ranges (YYYY-MM-DD..YYYY-MM-DD)',
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Filter to specific provider(s), comma-separated',
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
      if (args.compare !== undefined) cliArgs['compare'] = args.compare;
      if (args.provider !== undefined) cliArgs['provider'] = args.provider;
      if (args.clipboard) cliArgs['clipboard'] = true;
      if (args.open) cliArgs['open'] = true;
      if (args.upload !== undefined) cliArgs['upload'] = args.upload;

      await run(cliArgs);
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
  runMain(main);
}
