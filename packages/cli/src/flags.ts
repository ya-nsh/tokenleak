type CliArgs = Record<string, unknown>;

export const CLI_FLAG_ORDER = [
  'format',
  'theme',
  'since',
  'until',
  'days',
  'output',
  'width',
  'provider',
  'compare',
  'upload',
  'claude',
  'codex',
  'openCode',
  'allProviders',
  'listProviders',
  'more',
  'clipboard',
  'open',
  'liveServer',
  'noColor',
  'noInsights',
] as const;

export const CLI_FLAG_NAMES: Record<string, string> = {
  format: '--format',
  theme: '--theme',
  since: '--since',
  until: '--until',
  days: '--days',
  output: '--output',
  width: '--width',
  provider: '--provider',
  compare: '--compare',
  upload: '--upload',
  claude: '--claude',
  codex: '--codex',
  openCode: '--open-code',
  allProviders: '--all-providers',
  listProviders: '--list-providers',
  more: '--more',
  clipboard: '--clipboard',
  open: '--open',
  liveServer: '--live-server',
  noColor: '--no-color',
  noInsights: '--no-insights',
};

export function buildCliArgTokens(cliArgs: CliArgs): string[] {
  const tokens: string[] = [];

  for (const key of CLI_FLAG_ORDER) {
    const value = cliArgs[key];
    if (value === undefined || value === false || value === null) {
      continue;
    }

    const flag = CLI_FLAG_NAMES[key];
    if (!flag) continue;

    tokens.push(flag);
    if (value !== true) {
      tokens.push(String(value));
    }
  }

  return tokens;
}

export function buildCliPreview(cliArgs: CliArgs): string {
  const tokens = buildCliArgTokens(cliArgs);
  return tokens.length === 0 ? 'tokenleak' : `tokenleak ${tokens.join(' ')}`;
}
