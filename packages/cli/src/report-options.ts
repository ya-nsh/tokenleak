import { DEFAULT_DAYS } from '@tokenleak/core';
import { loadConfig } from './config.js';
import { loadEnvOverrides } from './env.js';
import { TokenleakError } from './errors.js';
import { defaultTerminalWidth, shouldUseColor } from './output-mode.js';

export const FORMAT_VALUES = ['json', 'svg', 'png', 'terminal', 'wrapped'] as const;

export const THEME_VALUES = ['dark', 'light'] as const;

/** Infer format from output file extension. */
export function inferFormatFromPath(filePath: string): (typeof FORMAT_VALUES)[number] | null {
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

/** Resolve effective config by merging config file, env vars, and CLI flags. */
export function resolveConfig(cliArgs: Record<string, unknown>): {
  format: (typeof FORMAT_VALUES)[number];
  theme: (typeof THEME_VALUES)[number];
  since?: string;
  until?: string;
  days: number;
  output: string | null;
  width: number;
  noColor: boolean;
  noInsights: boolean;
  more: boolean;
  compare?: string;
  provider?: string;
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  pi: boolean;
  openCode: boolean;
  allProviders: boolean;
  listProviders: boolean;
  clipboard: boolean;
  open: boolean;
  upload?: string;
  liveServer: boolean;
  wrappedLive: boolean;
  advisor: boolean;
  includePrompts: boolean;
} {
  const fileConfig = loadConfig();
  const envConfig = loadEnvOverrides();

  type Format = (typeof FORMAT_VALUES)[number];
  type Theme = (typeof THEME_VALUES)[number];

  // Defaults
  const merged: {
    format: Format;
    theme: Theme;
    days: number;
    output: string | null;
    width: number;
    noColor: boolean;
    noInsights: boolean;
    more: boolean;
    claude: boolean;
    codex: boolean;
    cursor: boolean;
    pi: boolean;
    openCode: boolean;
    allProviders: boolean;
    listProviders: boolean;
    clipboard: boolean;
    open: boolean;
    liveServer: boolean;
    wrappedLive: boolean;
    advisor: boolean;
    includePrompts: boolean;
  } = {
    format: 'terminal',
    theme: 'dark',
    days: DEFAULT_DAYS,
    output: null,
    width: defaultTerminalWidth(),
    noColor: !shouldUseColor(),
    noInsights: false,
    more: false,
    claude: false,
    codex: false,
    cursor: false,
    pi: false,
    openCode: false,
    allProviders: false,
    listProviders: false,
    clipboard: false,
    open: false,
    liveServer: false,
    wrappedLive: false,
    advisor: false,
    includePrompts: false,
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
  if (fileConfig.more !== undefined) merged.more = fileConfig.more;

  // Env overrides
  if (envConfig.format) merged.format = envConfig.format;
  if (envConfig.theme) merged.theme = envConfig.theme;
  if (envConfig.days !== undefined) merged.days = envConfig.days;

  // CLI flags (only override if explicitly provided)
  const result: ReturnType<typeof resolveConfig> = { ...merged };

  if (cliArgs['format'] !== undefined) {
    result.format = cliArgs['format'] as (typeof FORMAT_VALUES)[number];
  }
  if (cliArgs['theme'] !== undefined) {
    result.theme = cliArgs['theme'] as (typeof THEME_VALUES)[number];
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
  } else if (result.output !== null && !shouldUseColor({ isTTY: false })) {
    // A file is never a terminal: keep escape codes out of saved reports.
    result.noColor = true;
  }
  if (cliArgs['noInsights'] !== undefined) {
    result.noInsights = cliArgs['noInsights'] as boolean;
  }
  if (cliArgs['more'] !== undefined) {
    result.more = cliArgs['more'] as boolean;
  }
  if (cliArgs['compare'] !== undefined) {
    result.compare = cliArgs['compare'] as string;
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
  if (cliArgs['clipboard'] !== undefined) {
    result.clipboard = cliArgs['clipboard'] as boolean;
  }
  if (cliArgs['open'] !== undefined) {
    result.open = cliArgs['open'] as boolean;
  }
  if (cliArgs['upload'] !== undefined) {
    result.upload = cliArgs['upload'] as string;
  }
  if (cliArgs['liveServer'] !== undefined) {
    result.liveServer = cliArgs['liveServer'] as boolean;
  }
  if (cliArgs['wrappedLive'] !== undefined) {
    result.wrappedLive = cliArgs['wrappedLive'] as boolean;
  }
  if (cliArgs['advisor'] !== undefined) {
    result.advisor = cliArgs['advisor'] as boolean;
  }
  if (cliArgs['includePrompts'] !== undefined) {
    result.includePrompts = cliArgs['includePrompts'] as boolean;
  }

  return result;
}

export function resolveTerminalJsonFormat(
  commandName: string,
  cliArgs: Record<string, unknown>,
): 'json' | 'terminal' {
  if (typeof cliArgs['format'] === 'string') {
    const format = cliArgs['format'];
    if (format === 'json' || format === 'terminal') {
      return format;
    }

    throw new TokenleakError(
      `tokenleak ${commandName} only supports --format terminal or --format json`,
    );
  }

  if (typeof cliArgs['output'] === 'string') {
    const inferred = inferFormatFromPath(cliArgs['output']);
    if (inferred === 'json') {
      return 'json';
    }
  }

  return 'terminal';
}
