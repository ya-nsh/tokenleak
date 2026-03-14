import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';

export const INTERACTIVE_FLAG_LINES = [
  '-f, --format <format>   terminal | png | svg | json',
  '-t, --theme <theme>     dark | light',
  '-s, --since <date>      YYYY-MM-DD start date',
  '-u, --until <date>      YYYY-MM-DD end date',
  '-d, --days <number>     trailing days window',
  '-o, --output <path>     write output to a file',
  '-w, --width <number>    terminal render width',
  '-p, --provider <list>   comma-separated providers',
  '    --claude            shortcut for Claude Code',
  '    --codex             shortcut for Codex',
  '    --open-code         shortcut for Open Code',
  '    --all-providers     ignore provider filters',
  '    --list-providers    show provider registry',
  '    --compare <range>   auto or YYYY-MM-DD..YYYY-MM-DD',
  '    --more              richer PNG/SVG stats',
  '    --clipboard         copy rendered output',
  '    --open              open generated file',
  '    --upload <target>   gist',
  '-L, --live-server       local interactive dashboard',
  '    --no-color          disable ANSI colors',
  '    --no-insights       hide terminal insights',
  '    --help              print help',
  '    --version           print version',
] as const;

type CliArgs = Record<string, unknown>;

export type InteractiveRunRequest = {
  args: CliArgs;
  preview: string;
  title: string;
  loadingTitle: string;
  loadingDetail: string;
  executionMode: 'capture' | 'inherit';
};

export type InteractiveExecutionResult = {
  ok: boolean;
  summary: string;
  stdout: string;
  stderr: string;
};

type InteractiveCommand =
  | { type: 'run'; request: InteractiveRunRequest }
  | { type: 'show-help' }
  | { type: 'exit' };

type MenuOption = {
  digit: string;
  title: string;
  description: string;
  preview: string;
  select: () => Promise<InteractiveCommand>;
};

type InteractiveContext = {
  version: string;
  helpText: string;
};

type InteractiveState = {
  selectedIndex: number;
};

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const WHITE = `${ESC}97m`;
const HOME_CLEAR = '\x1b[H\x1b[J';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';

const PREVIEW_FLAG_ORDER = [
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

const PREVIEW_FLAG_NAMES: Record<string, string> = {
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

function color(text: string, code: string): string {
  return `${code}${text}${RESET}`;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function padVisible(text: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(text));
  return text + ' '.repeat(padding);
}

function truncateVisible(text: string, width: number): string {
  if (width <= 0) return '';
  const plain = stripAnsi(text);
  if (plain.length <= width) return text;
  if (width <= 3) return plain.slice(0, width);
  return `${plain.slice(0, width - 3)}...`;
}

function joinColumns(left: string[], right: string[], totalWidth: number): string[] {
  const gutter = 3;
  const leftWidth = Math.max(42, Math.min(58, Math.floor(totalWidth * 0.44)));
  const rightWidth = Math.max(36, totalWidth - leftWidth - gutter);
  const rows = Math.max(left.length, right.length);
  const lines: string[] = [];

  for (let index = 0; index < rows; index++) {
    const leftLine = truncateVisible(left[index] ?? '', leftWidth);
    const rightLine = truncateVisible(right[index] ?? '', rightWidth);
    lines.push(`${padVisible(leftLine, leftWidth)}${' '.repeat(gutter)}${rightLine}`);
  }

  return lines;
}

function renderRule(width: number): string {
  return color('-'.repeat(width), DIM);
}

function buildPreview(args: CliArgs): string {
  const parts = ['tokenleak'];

  for (const key of PREVIEW_FLAG_ORDER) {
    const value = args[key];
    if (value === undefined || value === false || value === null) {
      continue;
    }

    const flag = PREVIEW_FLAG_NAMES[key];
    if (!flag) continue;

    parts.push(flag);
    if (value !== true) {
      parts.push(String(value));
    }
  }

  return parts.join(' ');
}

function describeRequest(args: CliArgs): Pick<InteractiveRunRequest, 'title' | 'loadingTitle' | 'loadingDetail' | 'executionMode'> {
  const output = typeof args['output'] === 'string' ? args['output'] : null;

  if (args['liveServer']) {
    return {
      title: 'Live Dashboard',
      loadingTitle: 'Starting live dashboard',
      loadingDetail: 'Launching the local server. Press Ctrl-C in the live view to stop it, then you will return here.',
      executionMode: 'inherit',
    };
  }

  if (args['listProviders']) {
    return {
      title: 'Provider Registry',
      loadingTitle: 'Loading provider registry',
      loadingDetail: 'Checking registered providers and current availability.',
      executionMode: 'capture',
    };
  }

  if (args['compare']) {
    return {
      title: 'Compare Report',
      loadingTitle: 'Building compare report',
      loadingDetail: output
        ? `Computing period deltas and writing the report to ${output}.`
        : 'Computing period deltas for the current and previous windows.',
      executionMode: 'capture',
    };
  }

  switch (args['format']) {
    case 'json':
      return {
        title: 'JSON Export',
        loadingTitle: 'Generating JSON report',
        loadingDetail: output
          ? `Collecting token usage and writing JSON to ${output}.`
          : 'Collecting token usage and building structured JSON output.',
        executionMode: 'capture',
      };
    case 'svg':
      return {
        title: 'SVG Export',
        loadingTitle: 'Rendering SVG',
        loadingDetail: output
          ? `Rendering a vector card and writing it to ${output}.`
          : 'Rendering a vector card from your usage data.',
        executionMode: 'capture',
      };
    case 'png':
      return {
        title: 'PNG Export',
        loadingTitle: 'Rendering PNG',
        loadingDetail: output
          ? `Rendering the PNG card and writing it to ${output}. This can take a few seconds.`
          : 'Rendering the PNG card. This can take a few seconds.',
        executionMode: 'capture',
      };
    default:
      return {
        title: 'Terminal Dashboard',
        loadingTitle: 'Generating terminal dashboard',
        loadingDetail: 'Reading provider logs and aggregating token usage.',
        executionMode: 'capture',
      };
  }
}

function finalizeCliArgs(args: CliArgs): CliArgs {
  const finalized: CliArgs = { ...args };
  const format = finalized['format'];

  if (finalized['compare'] && (format === 'png' || format === 'svg')) {
    finalized['more'] = true;
  }

  if (finalized['open'] && finalized['output'] === undefined && typeof format === 'string') {
    if (format === 'png' || format === 'svg' || format === 'json') {
      finalized['output'] = `tokenleak.${format}`;
    } else {
      delete finalized['open'];
    }
  }

  if (format === 'png') {
    delete finalized['clipboard'];
    delete finalized['upload'];
  }

  return finalized;
}

function createRunCommand(args: CliArgs): InteractiveCommand {
  const finalizedArgs = finalizeCliArgs(args);
  return {
    type: 'run',
    request: {
      args: finalizedArgs,
      preview: buildPreview(finalizedArgs),
      ...describeRequest(finalizedArgs),
    },
  };
}

function renderMenu(options: MenuOption[], selectedIndex: number): string[] {
  return options.map((option, index) => {
    const isSelected = index === selectedIndex;
    const prefix = isSelected ? color('>', GREEN) : ' ';
    const number = isSelected ? color(option.digit, WHITE + BOLD) : color(option.digit, YELLOW);
    const title = isSelected ? color(option.title, WHITE + BOLD) : color(option.title, WHITE);
    const description = isSelected ? color(option.description, CYAN) : color(option.description, DIM);
    return `${prefix} [${number}] ${title} ${description}`;
  });
}

function renderFlagPanel(): string[] {
  return [
    color('All Flags', WHITE + BOLD),
    color('Every flag remains available while using the launcher.', DIM),
    '',
    ...INTERACTIVE_FLAG_LINES.map((line) => color(line, CYAN)),
  ];
}

function renderMenuPanel(
  context: InteractiveContext,
  options: MenuOption[],
  selectedIndex: number,
): string[] {
  const selected = options[selectedIndex]!;

  return [
    color('Tokenleak Interactive Launcher', WHITE + BOLD),
    `${color(`v${context.version}`, YELLOW)} ${color('interactive command center', CYAN)}`,
    '',
    color('Arrow keys move. Number keys jump directly. Enter runs the selected action.', DIM),
    color('Commands run inside this session, so you can keep selecting without leaving tokenleak.', DIM),
    '',
    ...renderMenu(options, selectedIndex),
    '',
    color('Preview', WHITE + BOLD),
    color(selected.preview, GREEN),
    '',
    color('Keys', WHITE + BOLD),
    `${color('Up/Down', YELLOW)} move  ${color('Enter', YELLOW)} run  ${color('H', YELLOW)} help  ${color('Q', YELLOW)} quit`,
    '',
    renderRule(44),
  ];
}

function renderHelpOverlay(helpText: string, width: number): string {
  const lines = helpText.trimEnd().split('\n');
  const header = [
    color('Tokenleak Help', WHITE + BOLD),
    color('Press Enter, Escape, H, or Q to return to the launcher.', DIM),
    '',
  ];

  return `${HOME_CLEAR}${HIDE_CURSOR}${[...header, ...lines.map((line) => truncateVisible(line, width))].join('\n')}`;
}

function renderLauncher(
  context: InteractiveContext,
  options: MenuOption[],
  selectedIndex: number,
): string {
  const width = process.stdout.columns ?? 120;
  const menuPanel = renderMenuPanel(context, options, selectedIndex);
  const flagPanel = renderFlagPanel();
  const body = width >= 118
    ? joinColumns(menuPanel, flagPanel, width)
    : [...menuPanel, '', ...flagPanel];

  return `${HOME_CLEAR}${HIDE_CURSOR}${body.join('\n')}`;
}

function renderProgressBar(frame: number, width: number): string {
  const innerWidth = Math.max(12, width - 2);
  const headSize = Math.max(4, Math.floor(innerWidth / 5));
  const travel = Math.max(1, innerWidth - headSize);
  const cycle = travel * 2;
  const offset = frame % cycle;
  const start = offset <= travel ? offset : cycle - offset;
  const cells = Array.from({ length: innerWidth }, (_, index) => {
    if (index >= start && index < start + headSize) {
      return '=';
    }
    return '-';
  }).join('');

  return color(`[${cells}]`, CYAN);
}

function renderLoading(request: InteractiveRunRequest, frame = 0, startedAt = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const progressBar = renderProgressBar(frame, 34);
  const lines = [
    color(request.loadingTitle, WHITE + BOLD),
    color(request.preview, CYAN),
    '',
    color(request.loadingDetail, DIM),
    '',
    color('Status', WHITE + BOLD),
    color('Working... stay in tokenleak while this finishes.', YELLOW),
    '',
    color('Progress', WHITE + BOLD),
    progressBar,
    color(`Elapsed ${elapsedSeconds}s`, DIM),
    '',
    renderRule(44),
  ];

  return `${HOME_CLEAR}${HIDE_CURSOR}${lines.join('\n')}`;
}

function clipOutputLines(lines: string[], limit: number): string[] {
  if (limit <= 0) return [];
  if (lines.length <= limit) return lines;

  const visible = lines.slice(0, Math.max(0, limit - 1));
  visible.push(color(`... ${lines.length - visible.length} more lines hidden`, DIM));
  return visible;
}

function renderOutputSection(title: string, content: string, width: number, maxLines: number): string[] {
  const normalized = content.trimEnd();
  if (!normalized) return [];

  const lines = normalized.split('\n').map((line) => truncateVisible(line, width));
  return [
    color(title, WHITE + BOLD),
    ...clipOutputLines(lines, maxLines),
    '',
  ];
}

function renderResult(request: InteractiveRunRequest, result: InteractiveExecutionResult): string {
  const width = Math.max(60, (process.stdout.columns ?? 120) - 1);
  const rows = process.stdout.rows ?? 40;
  const statusColor = result.ok ? GREEN : RED;
  const statusLabel = result.ok ? 'Completed' : 'Failed';
  const fixedLines = 10;
  const outputBudget = Math.max(8, rows - fixedLines);
  const firstSectionLines = result.stdout.trim() && result.stderr.trim()
    ? Math.max(4, Math.floor(outputBudget * 0.6))
    : outputBudget;
  const secondSectionLines = Math.max(4, outputBudget - firstSectionLines);

  const body = [
    color(request.title, WHITE + BOLD),
    color(request.preview, CYAN),
    '',
    `${color('Status', WHITE + BOLD)} ${color(statusLabel, statusColor)}`,
    color(result.summary, DIM),
    '',
    ...renderOutputSection('Output', result.stdout, width, firstSectionLines),
    ...renderOutputSection('Messages', result.stderr, width, secondSectionLines),
    renderRule(44),
    `${color('Enter', YELLOW)} launcher  ${color('Q', YELLOW)} quit`,
  ];

  return `${HOME_CLEAR}${HIDE_CURSOR}${body.join('\n')}`;
}

function enterAltScreen(): void {
  process.stdout.write(`${ALT_SCREEN_ON}${HOME_CLEAR}${HIDE_CURSOR}`);
}

function leaveAltScreen(): void {
  process.stdout.write(`${SHOW_CURSOR}${ALT_SCREEN_OFF}`);
}

function paint(content: string): void {
  process.stdout.write(content);
}

function suspendRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  process.stdout.write(SHOW_CURSOR);
}

function resumeRawMode(): void {
  emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdout.write(HIDE_CURSOR);
}

class InteractiveExitError extends Error {
  constructor() {
    super('Interactive session cancelled');
    this.name = 'InteractiveExitError';
  }
}

type Choice<T extends string> = {
  value: T;
  label: string;
  description: string;
};

const PROVIDER_CHOICES = [
  { value: 'claude-code', label: 'Claude Code', description: 'Anthropic project logs' },
  { value: 'codex', label: 'Codex', description: 'OpenAI session logs' },
  { value: 'open-code', label: 'Open Code', description: 'Open Code storage and database' },
] as const satisfies readonly Choice<string>[];

function isInteractiveExitError(error: unknown): boolean {
  return error instanceof InteractiveExitError;
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive whole number, received "${value}".`);
  }
  return parsed;
}

function renderChoiceScreen<T extends string>(
  title: string,
  description: string,
  options: readonly Choice<T>[],
  selectedIndex: number,
  selectedValues?: Set<T>,
  footer = `${color('Up/Down', YELLOW)} move  ${color('Space', YELLOW)} toggle  ${color('Enter', YELLOW)} confirm  ${color('Ctrl-C', YELLOW)} exit`,
): string {
  const optionLines = options.map((option, index) => {
    const isSelected = index === selectedIndex;
    const isChecked = selectedValues ? selectedValues.has(option.value) : isSelected;
    const pointer = isSelected ? color('>', GREEN) : ' ';
    const checkbox = selectedValues
      ? isChecked
        ? color('[x]', GREEN)
        : color('[ ]', DIM)
      : isSelected
        ? color('[•]', GREEN)
        : color('[ ]', DIM);
    const titleColor = isSelected ? WHITE + BOLD : WHITE;
    const descriptionColor = isSelected ? CYAN : DIM;
    return `${pointer} ${checkbox} ${color(option.label, titleColor)} ${color(option.description, descriptionColor)}`;
  });

  const lines = [
    color(title, WHITE + BOLD),
    color(description, DIM),
    '',
    ...optionLines,
    '',
    renderRule(44),
    footer,
  ];

  return `${HOME_CLEAR}${HIDE_CURSOR}${lines.join('\n')}`;
}

async function ask(prompt: string, initialValue = ''): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let settled = false;

  return new Promise<string>((resolve, reject) => {
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      readline.off('SIGINT', onSigint);
      readline.close();
      fn();
    };

    const onSigint = (): void => {
      finish(() => reject(new InteractiveExitError()));
    };

    readline.on('SIGINT', onSigint);

    const suffix = initialValue ? ` (${initialValue})` : '';
    readline.question(`${prompt}${suffix}: `)
      .then((value) => {
        finish(() => resolve(value.trim() || initialValue));
      })
      .catch((error) => {
        finish(() => reject(error));
      });
  });
}

async function askYesNo(prompt: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const value = (await ask(`${prompt} [${hint}]`)).toLowerCase();
  if (value === '') return defaultValue;
  return value === 'y' || value === 'yes';
}

async function promptSingleChoice<T extends string>(
  title: string,
  description: string,
  options: readonly Choice<T>[],
  initialIndex = 0,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let selectedIndex = Math.max(0, Math.min(initialIndex, options.length - 1));

    const onKeypress = (_input: string, key: { name?: string; ctrl?: boolean; sequence?: string }): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new InteractiveExitError());
        return;
      }

      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
        return;
      }

      const digit = key.sequence?.match(/^[1-9]$/)?.[0];
      if (digit) {
        const index = Number(digit) - 1;
        if (index < options.length) {
          selectedIndex = index;
          cleanup();
          resolve(options[selectedIndex]!.value);
        }
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(options[selectedIndex]!.value);
      }
    };

    function render(): void {
      paint(renderChoiceScreen(title, description, options, selectedIndex, undefined, `${color('Up/Down', YELLOW)} move  ${color('1-9', YELLOW)} pick  ${color('Enter', YELLOW)} confirm  ${color('Ctrl-C', YELLOW)} exit`));
    }

    function cleanup(): void {
      process.stdin.off('keypress', onKeypress);
      suspendRawMode();
    }

    render();
    resumeRawMode();
    process.stdin.on('keypress', onKeypress);
  });
}

async function promptMultiChoice<T extends string>(
  title: string,
  description: string,
  options: readonly Choice<T>[],
  initialValues: readonly T[] = [],
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    let selectedIndex = 0;
    const selectedValues = new Set<T>(initialValues);

    const onKeypress = (_input: string, key: { name?: string; ctrl?: boolean; sequence?: string }): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new InteractiveExitError());
        return;
      }

      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
        return;
      }

      if (key.name === 'space') {
        toggleSelected(selectedIndex);
        render();
        return;
      }

      const digit = key.sequence?.match(/^[1-9]$/)?.[0];
      if (digit) {
        const index = Number(digit) - 1;
        if (index < options.length) {
          selectedIndex = index;
          toggleSelected(selectedIndex);
          render();
        }
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(Array.from(selectedValues));
      }
    };

    function toggleSelected(index: number): void {
      const value = options[index]!.value;
      if (selectedValues.has(value)) {
        selectedValues.delete(value);
      } else {
        selectedValues.add(value);
      }
    }

    function render(): void {
      paint(renderChoiceScreen(title, description, options, selectedIndex, selectedValues));
    }

    function cleanup(): void {
      process.stdin.off('keypress', onKeypress);
      suspendRawMode();
    }

    render();
    resumeRawMode();
    process.stdin.on('keypress', onKeypress);
  });
}

function applySelectedProviders(args: CliArgs, providers: readonly string[]): void {
  if (providers.length === 0) return;
  args['provider'] = providers.join(',');
}

async function promptTheme(defaultTheme: 'dark' | 'light' = 'dark'): Promise<'dark' | 'light'> {
  const theme = await promptSingleChoice(
    'Theme',
    'Pick the rendering theme.',
    [
      { value: 'dark', label: 'Dark', description: 'High-contrast dark canvas' },
      { value: 'light', label: 'Light', description: 'Bright export with light background' },
    ],
    defaultTheme === 'light' ? 1 : 0,
  );
  return theme;
}

async function promptDateWindow(): Promise<CliArgs> {
  const choice = await promptSingleChoice(
    'Date Window',
    'Choose how much history to include.',
    [
      { value: '7', label: 'Last 7 days', description: 'Quick recent snapshot' },
      { value: '30', label: 'Last 30 days', description: 'Short-term trend window' },
      { value: '90', label: 'Last 90 days', description: 'Default overview' },
      { value: '365', label: 'Last 365 days', description: 'Long-range usage pattern' },
      { value: 'custom', label: 'Custom range', description: 'Enter exact dates manually' },
    ],
    2,
  );

  if (choice !== 'custom') {
    return { days: Number(choice) };
  }

  const since = await ask('Since date YYYY-MM-DD');
  const until = await ask('Until date YYYY-MM-DD (blank for today)');
  const args: CliArgs = { since };
  if (until) args['until'] = until;
  return args;
}

async function promptProviderSelection(title = 'Provider Filter'): Promise<string[]> {
  return promptMultiChoice(
    title,
    'Toggle one or more providers. Leave everything unchecked to use auto-detection.',
    PROVIDER_CHOICES,
  );
}

async function promptOutputPath(defaultPath: string): Promise<string> {
  return ask('Output file', defaultPath);
}

async function promptWidth(): Promise<number | null> {
  const choice = await promptSingleChoice(
    'Terminal Width',
    'Choose the dashboard width.',
    [
      { value: '80', label: '80 columns', description: 'Standard terminal width' },
      { value: '100', label: '100 columns', description: 'Balanced dashboard layout' },
      { value: '120', label: '120 columns', description: 'Wide dashboard layout' },
      { value: 'custom', label: 'Custom width', description: 'Enter an exact width' },
    ],
    1,
  );

  if (choice !== 'custom') {
    return Number(choice);
  }

  while (true) {
    try {
      return parsePositiveInteger(await ask('Custom width'));
    } catch (error: unknown) {
      paint(`${HOME_CLEAR}${SHOW_CURSOR}${color('Invalid width', RED)}\n${color(error instanceof Error ? error.message : String(error), DIM)}\n\nPress Enter to try again.`);
      await ask('');
    }
  }
}

async function promptCompareSetting(): Promise<string | null> {
  const choice = await promptSingleChoice(
    'Compare Mode',
    'Optionally compare the current range against an earlier period.',
    [
      { value: 'off', label: 'No compare', description: 'Render a standard single-period report' },
      { value: 'auto', label: 'Auto compare', description: 'Split the selected window automatically' },
      { value: 'custom', label: 'Custom compare range', description: 'Provide an explicit YYYY-MM-DD..YYYY-MM-DD range' },
    ],
  );

  if (choice === 'off') return null;
  if (choice === 'auto') return 'auto';
  return ask('Previous range YYYY-MM-DD..YYYY-MM-DD');
}

async function buildDashboardPreset(): Promise<InteractiveCommand> {
  const rangeArgs = await promptDateWindow();
  const providers = await promptProviderSelection();
  const width = await promptWidth();
  const noInsights = await askYesNo('Hide insights panel', false);
  const noColor = await askYesNo('Disable ANSI colors', false);

  const args: CliArgs = { ...rangeArgs };
  applySelectedProviders(args, providers);
  if (width) args['width'] = width;
  if (noInsights) args['noInsights'] = true;
  if (noColor) args['noColor'] = true;

  return createRunCommand(args);
}

async function buildJsonPreset(): Promise<InteractiveCommand> {
  const rangeArgs = await promptDateWindow();
  const providers = await promptProviderSelection();
  const compare = await promptCompareSetting();
  const saveToFile = await askYesNo('Write JSON to a file', false);
  const clipboard = !saveToFile && await askYesNo('Copy JSON to clipboard after render', false);

  const args: CliArgs = {
    format: 'json',
    ...rangeArgs,
  };
  applySelectedProviders(args, providers);
  if (compare) args['compare'] = compare;
  if (saveToFile) {
    args['output'] = await promptOutputPath(compare ? 'tokenleak-compare.json' : 'tokenleak.json');
  }
  if (clipboard) args['clipboard'] = true;

  return createRunCommand(args);
}

async function buildImagePreset(format: 'svg' | 'png'): Promise<InteractiveCommand> {
  const theme = await promptTheme();
  const rangeArgs = await promptDateWindow();
  const providers = await promptProviderSelection('Provider Filter');
  const compare = await promptCompareSetting();
  const output = await promptOutputPath(`tokenleak.${format}`);
  const shouldOpen = await askYesNo('Open the file when done', true);
  const more = compare
    ? true
    : await askYesNo('Enable --more stats', format === 'png');

  const args: CliArgs = {
    format,
    theme,
    output,
    open: shouldOpen,
    more,
    ...rangeArgs,
  };
  applySelectedProviders(args, providers);
  if (compare) args['compare'] = compare;

  return createRunCommand(args);
}

async function buildComparePreset(): Promise<InteractiveCommand> {
  const rangeArgs = await promptDateWindow();
  const providers = await promptProviderSelection();
  const compareMode = await promptSingleChoice(
    'Reference Period',
    'Choose how the earlier comparison period should be defined.',
    [
      { value: 'auto', label: 'Auto compare', description: 'Split the chosen window automatically' },
      { value: 'custom', label: 'Custom compare range', description: 'Enter an explicit prior range manually' },
    ],
  );
  const compare = compareMode === 'custom'
    ? await ask('Previous range YYYY-MM-DD..YYYY-MM-DD')
    : 'auto';
  const saveToFile = await askYesNo('Write compare output to a file', false);

  const args: CliArgs = {
    format: 'json',
    compare,
    ...rangeArgs,
  };
  applySelectedProviders(args, providers);

  if (saveToFile) {
    args['output'] = await promptOutputPath('tokenleak-compare.json');
  }

  return createRunCommand(args);
}

async function buildLivePreset(): Promise<InteractiveCommand> {
  const theme = await promptTheme();
  const rangeArgs = await promptDateWindow();
  const providers = await promptProviderSelection();
  const more = await askYesNo('Enable --more stats', true);

  const args: CliArgs = {
    liveServer: true,
    theme,
    more,
    ...rangeArgs,
  };
  applySelectedProviders(args, providers);
  return createRunCommand(args);
}

async function askFormatChoice(): Promise<string> {
  return promptSingleChoice(
    'Output Format',
    'Choose the primary renderer for this command.',
    [
      { value: 'terminal', label: 'Terminal', description: 'Dashboard in the current terminal' },
      { value: 'json', label: 'JSON', description: 'Structured machine-readable output' },
      { value: 'svg', label: 'SVG', description: 'Shareable vector export' },
      { value: 'png', label: 'PNG', description: 'Raster export for social and docs' },
    ],
  );
}

async function buildCustomCommand(): Promise<InteractiveCommand> {
  const mode = await promptSingleChoice(
    'Command Type',
    'Choose the command family you want to configure.',
    [
      { value: 'run', label: 'Standard command', description: 'Render terminal, JSON, SVG, or PNG output' },
      { value: 'live-server', label: 'Live server', description: 'Launch the browser dashboard locally' },
      { value: 'list-providers', label: 'List providers', description: 'Inspect registered provider backends' },
    ],
  );

  if (mode === 'live-server') {
    return buildLivePreset();
  }

  if (mode === 'list-providers') {
    return createRunCommand({ listProviders: true });
  }

  const format = await askFormatChoice();
  const theme = format === 'terminal' ? null : await promptTheme();
  const rangeArgs = await promptDateWindow();
  const providers = await promptProviderSelection();
  const compare = await promptCompareSetting();
  const width = format === 'terminal' ? await promptWidth() : null;
  const output = format === 'terminal'
    ? await ask('Output file (blank keeps stdout)')
    : await ask(`Output file (blank keeps ${format === 'json' ? 'stdout' : `tokenleak.${format}`})`);
  const noColor = await askYesNo('Disable ANSI colors', false);
  const noInsights = format === 'terminal' ? await askYesNo('Hide insights', false) : false;
  const more = await askYesNo('Enable --more stats', format === 'png' || format === 'svg');
  const clipboard = format !== 'png' ? await askYesNo('Copy output to clipboard', false) : false;
  const open = format !== 'terminal' ? await askYesNo('Open generated file', false) : false;
  const upload = format !== 'png' ? await ask('Upload target [blank/gist]') : '';

  const args: CliArgs = {
    format,
    ...rangeArgs,
  };

  if (theme) args['theme'] = theme;
  if (compare) args['compare'] = compare;
  if (width) args['width'] = width;
  if (output) args['output'] = output;
  if (noColor) args['noColor'] = true;
  if (noInsights) args['noInsights'] = true;
  if (more) args['more'] = true;
  if (clipboard) args['clipboard'] = true;
  if (open) args['open'] = true;
  if (upload) args['upload'] = upload;

  applySelectedProviders(args, providers);

  return createRunCommand(args);
}

function createMenuOptions(): MenuOption[] {
  return [
    {
      digit: '1',
      title: 'Launch Dashboard',
      description: 'guided terminal view',
      preview: 'tokenleak --days 90',
      select: buildDashboardPreset,
    },
    {
      digit: '2',
      title: 'Export JSON',
      description: 'structured output for scripts',
      preview: 'tokenleak --format json',
      select: buildJsonPreset,
    },
    {
      digit: '3',
      title: 'Export SVG',
      description: 'shareable vector card',
      preview: 'tokenleak --format svg --output tokenleak.svg',
      select: async () => buildImagePreset('svg'),
    },
    {
      digit: '4',
      title: 'Export PNG',
      description: 'social-ready raster image',
      preview: 'tokenleak --format png --output tokenleak.png --more',
      select: async () => buildImagePreset('png'),
    },
    {
      digit: '5',
      title: 'Compare Periods',
      description: 'diff current vs previous usage',
      preview: 'tokenleak --compare auto --format json',
      select: buildComparePreset,
    },
    {
      digit: '6',
      title: 'Start Live Server',
      description: 'browser dashboard on localhost',
      preview: 'tokenleak --live-server --theme dark',
      select: buildLivePreset,
    },
    {
      digit: '7',
      title: 'Build Custom Command',
      description: 'configure flags interactively',
      preview: 'tokenleak --format terminal --days 90',
      select: buildCustomCommand,
    },
    {
      digit: '8',
      title: 'Full Help',
      description: 'examples and complete usage',
      preview: 'tokenleak --help',
      select: async () => ({ type: 'show-help' }),
    },
    {
      digit: '9',
      title: 'List Providers',
      description: 'detect available registries',
      preview: 'tokenleak --list-providers',
      select: async () => createRunCommand({ listProviders: true }),
    },
    {
      digit: '0',
      title: 'Exit',
      description: 'close the launcher',
      preview: 'exit',
      select: async () => ({ type: 'exit' }),
    },
  ];
}

async function waitForSingleKey(): Promise<{ name?: string; ctrl?: boolean }> {
  return new Promise((resolve) => {
    const onKeypress = (_input: string, key: { name?: string; ctrl?: boolean }) => {
      process.stdin.off('keypress', onKeypress);
      suspendRawMode();
      resolve(key);
    };

    resumeRawMode();
    process.stdin.on('keypress', onKeypress);
  });
}

async function promptForMenuCommand(
  context: InteractiveContext,
  options: MenuOption[],
  state: InteractiveState,
): Promise<InteractiveCommand> {
  let showHelp = false;
  let resolving = false;

  return new Promise((resolve, reject) => {
    const onKeypress = async (_input: string, key: { name?: string; sequence?: string; ctrl?: boolean }) => {
      if (resolving) {
        return;
      }

      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve({ type: 'exit' });
        return;
      }

      if (showHelp) {
        if (
          key.name === 'escape' ||
          key.name === 'return' ||
          key.name === 'enter' ||
          key.name === 'q' ||
          key.name === 'h'
        ) {
          showHelp = false;
          paint(renderLauncher(context, options, state.selectedIndex));
        }
        return;
      }

      if (key.name === 'up') {
        state.selectedIndex = (state.selectedIndex - 1 + options.length) % options.length;
        paint(renderLauncher(context, options, state.selectedIndex));
        return;
      }

      if (key.name === 'down') {
        state.selectedIndex = (state.selectedIndex + 1) % options.length;
        paint(renderLauncher(context, options, state.selectedIndex));
        return;
      }

      if (key.name === 'h') {
        showHelp = true;
        paint(renderHelpOverlay(context.helpText, Math.max(60, (process.stdout.columns ?? 120) - 1)));
        return;
      }

      if (key.name === 'q' || key.name === 'escape') {
        cleanup();
        resolve({ type: 'exit' });
        return;
      }

      const digit = key.sequence?.match(/^[0-9]$/)?.[0];
      if (digit) {
        const nextIndex = options.findIndex((option) => option.digit === digit);
        if (nextIndex >= 0) {
          state.selectedIndex = nextIndex;
          if (digit === '8') {
            showHelp = true;
            paint(renderHelpOverlay(context.helpText, Math.max(60, (process.stdout.columns ?? 120) - 1)));
            return;
          }

          cleanup();
          resolving = true;
          try {
            const command = await options[nextIndex]!.select();
            resolve(command);
          } catch (error: unknown) {
            if (isInteractiveExitError(error)) {
              resolve({ type: 'exit' });
              return;
            }
            reject(error);
          }
        }
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolving = true;
        try {
          const command = await options[state.selectedIndex]!.select();
          resolve(command);
        } catch (error: unknown) {
          if (isInteractiveExitError(error)) {
            resolve({ type: 'exit' });
            return;
          }
          reject(error);
        }
      }
    };

    function cleanup(): void {
      process.stdin.off('keypress', onKeypress);
      suspendRawMode();
    }

    paint(renderLauncher(context, options, state.selectedIndex));
    resumeRawMode();
    process.stdin.on('keypress', onKeypress);
  });
}

async function showExecutionResult(
  request: InteractiveRunRequest,
  result: InteractiveExecutionResult,
): Promise<'menu' | 'exit'> {
  paint(renderResult(request, result));
  const key = await waitForSingleKey();
  if (key.ctrl && key.name === 'c') return 'exit';
  if (key.name === 'q' || key.name === 'escape') return 'exit';
  return 'menu';
}

export function shouldStartInteractiveCli(
  argv: string[],
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
): boolean {
  return argv.length === 0 && stdinIsTTY && stdoutIsTTY;
}

export async function startInteractiveCli(
  context: InteractiveContext,
  execute: (request: InteractiveRunRequest) => Promise<InteractiveExecutionResult>,
): Promise<void> {
  const options = createMenuOptions();
  const state: InteractiveState = { selectedIndex: 0 };
  let interrupted = false;

  const onSigint = (): void => {
    interrupted = true;
  };

  enterAltScreen();
  process.on('SIGINT', onSigint);

  try {
    while (true) {
      if (interrupted) {
        return;
      }

      const command = await promptForMenuCommand(context, options, state);
      if (command.type === 'exit') {
        return;
      }

      if (command.type === 'show-help') {
        continue;
      }

      const startedAt = Date.now();
      let loadingFrame = 0;
      paint(renderLoading(command.request, loadingFrame, startedAt));
      const loadingTicker = setInterval(() => {
        loadingFrame += 1;
        paint(renderLoading(command.request, loadingFrame, startedAt));
      }, 120);

      let result: InteractiveExecutionResult;
      try {
        if (command.request.executionMode === 'inherit') {
          clearInterval(loadingTicker);
          leaveAltScreen();
          try {
            result = await execute(command.request);
          } finally {
            enterAltScreen();
          }
        } else {
          result = await execute(command.request);
        }
      } finally {
        clearInterval(loadingTicker);
      }

      if (interrupted) {
        return;
      }

      const next = await showExecutionResult(command.request, result);
      if (next === 'exit') {
        return;
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
    suspendRawMode();
    leaveAltScreen();
  }
}
