import type { DateRange, ProviderData, ProviderWarning } from '@tokenleak/core';
import {
  AmpProvider,
  AntigravityProvider,
  ClaudeCodeProvider,
  CodebuffProvider,
  CodexProvider,
  CopilotProvider,
  CrushProvider,
  CursorProvider,
  DroidProvider,
  GeminiProvider,
  GooseProvider,
  HermesProvider,
  KiloCodeProvider,
  KiloProvider,
  KimiProvider,
  KiroProvider,
  MuxProvider,
  OpenClawProvider,
  OpenCodeProvider,
  PiProvider,
  ProviderRegistry,
  QwenProvider,
  RooCodeProvider,
  SyntheticProvider,
  TraeProvider,
  ZedProvider,
} from '@tokenleak/registry';
import type { IProvider } from '@tokenleak/registry';
import { hasCursorUsageCache, isCursorLoggedIn, shouldSyncCursorForRun } from './cursor.js';
import { computeDateRange } from './date-range.js';
import { TokenleakError } from './errors.js';
import { isVerbose } from './output-mode.js';
import { describeWarningsVerbose, summarizeWarnings } from './warning-summary.js';

const PROVIDER_SHORTCUTS = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  pi: 'pi',
  openCode: 'open-code',
} as const;
/** Every accepted provider spelling; a Map so user tokens never reach Object.prototype. */
const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    anthropic: 'claude-code',
    claude: 'claude-code',
    'claude-code': 'claude-code',
    claudecode: 'claude-code',
    codex: 'codex',
    cursor: 'cursor',
    'cursor-ide': 'cursor',
    cursoride: 'cursor',
    openai: 'codex',
    pi: 'pi',
    'pi-mono': 'pi',
    'open-code': 'open-code',
    open_code: 'open-code',
    opencode: 'open-code',
    gemini: 'gemini',
    google: 'gemini',
    copilot: 'copilot',
    'github-copilot': 'copilot',
    'copilot-otel': 'copilot',
    amp: 'amp',
    'sourcegraph-amp': 'amp',
    codebuff: 'codebuff',
    manicode: 'codebuff',
    droid: 'droid',
    factory: 'droid',
    qwen: 'qwen',
    'roo-code': 'roo-code',
    roo: 'roo-code',
    roocode: 'roo-code',
    'kilo-code': 'kilo-code',
    kilocode: 'kilo-code',
    kimi: 'kimi',
    'kimi-cli': 'kimi',
    kilo: 'kilo',
    'kilo-cli': 'kilo',
    mux: 'mux',
    crush: 'crush',
    openclaw: 'openclaw',
    'open-claw': 'openclaw',
    hermes: 'hermes',
    'hermes-agent': 'hermes',
    goose: 'goose',
    antigravity: 'antigravity',
    zed: 'zed',
    'zed-agent': 'zed',
    kiro: 'kiro',
    trae: 'trae',
    synthetic: 'synthetic',
    octofriend: 'synthetic',
  }),
);
const PROVIDER_ALIAS_GROUPS: Record<string, string[]> = {
  'claude-code': ['anthropic', 'claude', 'claudecode'],
  codex: ['openai'],
  cursor: ['cursor-ide', 'cursoride'],
  pi: ['pi-mono'],
  'open-code': ['opencode', 'open_code'],
  gemini: ['google'],
  copilot: ['github-copilot', 'copilot-otel'],
  amp: ['sourcegraph-amp'],
  codebuff: ['manicode'],
  droid: ['factory'],
  'roo-code': ['roo', 'roocode'],
  'kilo-code': ['kilocode'],
  kimi: ['kimi-cli'],
  kilo: ['kilo-cli'],
  openclaw: ['open-claw'],
  hermes: ['hermes-agent'],
  zed: ['zed-agent'],
  synthetic: ['octofriend'],
};
const EXPLICIT_ONLY_PROVIDERS = new Set(['synthetic']);

export interface ProviderFilterConfig {
  provider?: string;
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  pi: boolean;
  openCode: boolean;
}

export interface ProviderLoadConfig extends ProviderFilterConfig {
  since?: string;
  until?: string;
  days: number;
  allProviders: boolean;
}

export function normalizeProviderToken(token: string): string {
  const normalized = token.trim().toLowerCase().replace(/\s+/g, '-');
  return PROVIDER_ALIASES.get(normalized) ?? normalized;
}

function getRequestedProviders(config: ProviderFilterConfig): Set<string> {
  const requested = new Set<string>();

  if (config.provider) {
    for (const token of config.provider.split(',')) {
      const normalized = normalizeProviderToken(token);
      if (normalized) {
        requested.add(normalized);
      }
    }
  }

  if (config.claude) requested.add(PROVIDER_SHORTCUTS.claude);
  if (config.codex) requested.add(PROVIDER_SHORTCUTS.codex);
  if (config.cursor) requested.add(PROVIDER_SHORTCUTS.cursor);
  if (config.pi) requested.add(PROVIDER_SHORTCUTS.pi);
  if (config.openCode) requested.add(PROVIDER_SHORTCUTS.openCode);

  return requested;
}

function providerMatchesFilter(provider: IProvider, requested: Set<string>): boolean {
  if (requested.size === 0) return true;

  const candidates = [
    normalizeProviderToken(provider.name),
    normalizeProviderToken(provider.displayName),
  ];

  return candidates.some((candidate) => requested.has(candidate));
}

function isExplicitOnlyProvider(provider: IProvider): boolean {
  return EXPLICIT_ONLY_PROVIDERS.has(provider.name);
}

function registerBuiltInProviders(registry: ProviderRegistry): void {
  registry.register(new ClaudeCodeProvider());
  registry.register(new CodexProvider());
  registry.register(new CursorProvider());
  registry.register(new GeminiProvider());
  registry.register(new CopilotProvider());
  registry.register(new AmpProvider());
  registry.register(new CodebuffProvider());
  registry.register(new DroidProvider());
  registry.register(new QwenProvider());
  registry.register(new RooCodeProvider());
  registry.register(new KiloCodeProvider());
  registry.register(new KimiProvider());
  registry.register(new KiloProvider());
  registry.register(new MuxProvider());
  registry.register(new CrushProvider());
  registry.register(new OpenClawProvider());
  registry.register(new HermesProvider());
  registry.register(new GooseProvider());
  registry.register(new AntigravityProvider());
  registry.register(new ZedProvider());
  registry.register(new KiroProvider());
  registry.register(new TraeProvider());
  registry.register(new SyntheticProvider());
  registry.register(new PiProvider());
  registry.register(new OpenCodeProvider());
}

function buildProviderList(providers: IProvider[], availability: Map<string, boolean>): string {
  const lines = ['Registered providers:', ''];

  for (const provider of providers) {
    const aliases = PROVIDER_ALIAS_GROUPS[provider.name] ?? [];
    const status = availability.get(provider.name) ? 'available' : 'unavailable';
    lines.push(`- ${provider.name} (${provider.displayName}) [${status}]`);
    if (aliases.length > 0) {
      lines.push(`  aliases: ${aliases.join(', ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Print every registered provider with its aliases and availability (`--list-providers`). */
export async function writeProviderList(): Promise<void> {
  const providers = createRegistry().getAll();
  const availabilityResults = await Promise.all(
    providers.map(async (provider) => [provider.name, await provider.isAvailable()] as const),
  );
  process.stdout.write(buildProviderList(providers, new Map(availabilityResults)));
}

function createRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registerBuiltInProviders(registry);
  return registry;
}

export function validateProviderSelection(
  config: Pick<ProviderLoadConfig, 'allProviders'> & ProviderFilterConfig,
): void {
  if (
    config.allProviders &&
    (config.provider ||
      config.claude ||
      config.codex ||
      config.cursor ||
      config.pi ||
      config.openCode)
  ) {
    throw new TokenleakError('--all-providers cannot be combined with provider filters');
  }
}

export async function selectAvailableProviders(
  config: Pick<ProviderLoadConfig, 'allProviders'> &
    ProviderFilterConfig & { syncCursor?: boolean },
): Promise<IProvider[]> {
  validateProviderSelection(config);

  const requestedProviders = getRequestedProviders(config);
  const requestedCursor = requestedProviders.has(PROVIDER_SHORTCUTS.cursor);
  if (requestedCursor && !isCursorLoggedIn() && !hasCursorUsageCache()) {
    throw new TokenleakError(
      'Cursor is selected but not authenticated. Run `tokenleak cursor login` first.',
    );
  }
  // Status bars refresh constantly; they read the Cursor cache without a network round trip.
  const cursorSync =
    config.syncCursor === false ? { attempted: false } : await shouldSyncCursorForRun(config);
  if (cursorSync.error) {
    if (requestedCursor && !hasCursorUsageCache()) {
      throw new TokenleakError(cursorSync.error);
    }
    // Only interrupt the user about Cursor when they asked for Cursor.
    if (requestedCursor || isVerbose()) {
      const fallback = hasCursorUsageCache() ? 'using cached data' : 'skipping Cursor';
      process.stderr.write(`Cursor sync failed, ${fallback}: ${cursorSync.error}\n`);
    }
  }

  const registry = createRegistry();
  let available = await registry.getAvailable();

  if (!requestedProviders.has('synthetic')) {
    available = available.filter((provider) => !isExplicitOnlyProvider(provider));
  }

  if (!config.allProviders && requestedProviders.size > 0) {
    if (
      config.provider &&
      (config.claude || config.codex || config.cursor || config.pi || config.openCode)
    ) {
      process.stderr.write(
        `Combining provider filters: ${Array.from(requestedProviders).join(', ')}\n`,
      );
    }
    available = available.filter((provider) => providerMatchesFilter(provider, requestedProviders));
  }

  return available;
}

export async function loadProviderData(config: ProviderLoadConfig): Promise<{
  dateRange: DateRange;
  providerDataList: ProviderData[];
}> {
  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });

  return loadProviderDataForRange(config, dateRange);
}

export async function loadProviderDataForRange(
  config: Pick<ProviderLoadConfig, 'allProviders'> &
    ProviderFilterConfig & { syncCursor?: boolean },
  dateRange: DateRange,
  available: IProvider[] | null = null,
): Promise<{
  dateRange: DateRange;
  providerDataList: ProviderData[];
}> {
  const resolvedProviders = available ?? (await selectAvailableProviders(config));
  const availableProviders = resolvedProviders;
  if (availableProviders.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const results = await Promise.all(
    availableProviders.map(async (provider) => {
      try {
        return { data: await provider.load(dateRange), failed: false };
      } catch {
        const data: ProviderData = {
          provider: provider.name,
          displayName: provider.displayName,
          daily: [],
          totalTokens: 0,
          totalCost: 0,
          colors: provider.colors,
          events: [],
          warnings: [{ kind: 'provider-load', file: provider.name, count: 1 }],
          costCompleteness: {
            status: 'unknown',
            totalTokens: 0,
            pricedTokens: 0,
            unpricedTokens: 0,
            unknownModels: [],
          },
        };
        return { data, failed: true };
      }
    }),
  );

  const providerDataList = results.map((result) => result.data);
  if (results.every((result) => result.failed)) {
    throw new TokenleakError('No provider data found');
  }

  return { dateRange, providerDataList };
}

function collectProviderWarnings(
  providers: ProviderData[],
): Array<{ provider: string; warning: ProviderWarning }> {
  return providers.flatMap((provider) =>
    (provider.warnings ?? []).map((warning) => ({ provider: provider.displayName, warning })),
  );
}

export function emitProviderWarnings(...providerLists: ProviderData[][]): void {
  const warnings = providerLists.flatMap((providers) => collectProviderWarnings(providers));
  const lines = isVerbose() ? describeWarningsVerbose(warnings) : summarizeWarnings(warnings);
  for (const line of lines) process.stderr.write(`${line}\n`);
}

export async function loadOptimizationInput(config: ProviderLoadConfig): Promise<{
  dateRange: DateRange;
  providers: ProviderData[];
}> {
  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });
  const { providerDataList } = await loadProviderDataForRange(config, dateRange);
  emitProviderWarnings(providerDataList);
  return { dateRange, providers: providerDataList };
}
