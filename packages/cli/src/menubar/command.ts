import { existsSync } from 'node:fs';
import { TokenleakError } from '../errors.js';
import { recordClaudeStatuslineSnapshot } from './claude-statusline.js';
import { formatTimestamp } from './format.js';
import {
  installMenubar,
  openDashboardInTerminal,
  openMenubarApp,
  printMenubarStatus,
  startMenubarApp,
  stopMenubarApp,
  uninstallMenubar,
} from './install.js';
import { resolveMenubarPaths } from './paths.js';
import {
  createDefaultMenubarConfig,
  readMenubarConfig,
  refreshMenubarSnapshot,
  writeMenubarConfig,
} from './state.js';

interface ParsedMenubarArgs {
  command: string;
  homeDir?: string;
  pollIntervalSeconds?: number;
  once: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedMenubarArgs {
  const parsed: ParsedMenubarArgs = {
    command: argv[0] ?? 'help',
    once: false,
    help: false,
  };

  let index = 1;
  while (index < argv.length) {
    const arg = argv[index]!;
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        index += 1;
        break;
      case '--home':
        if (!argv[index + 1]) throw new TokenleakError('--home requires a value');
        parsed.homeDir = argv[index + 1]!;
        index += 2;
        break;
      case '--poll':
        if (!argv[index + 1]) throw new TokenleakError('--poll requires a value');
        parsed.pollIntervalSeconds = Number(argv[index + 1]!);
        index += 2;
        break;
      case '--once':
        parsed.once = true;
        index += 1;
        break;
      default:
        throw new TokenleakError(`Unknown menubar flag "${arg}"`);
    }
  }

  return parsed;
}

function resolveCommandConfig(parsed: ParsedMenubarArgs) {
  const paths = resolveMenubarPaths(parsed.homeDir);
  const config = existsSync(paths.configPath)
    ? readMenubarConfig(paths)
    : createDefaultMenubarConfig();

  if (parsed.pollIntervalSeconds !== undefined) {
    config.pollIntervalSeconds = Math.max(10, Math.round(parsed.pollIntervalSeconds));
    writeMenubarConfig(paths, config);
  }

  return { paths, config };
}

export function buildMenubarHelpText(): string {
  return [
    'tokenleak menubar',
    'Install and manage the macOS quota menubar app for Codex and Claude Code.',
    '',
    'Usage:',
    '  tokenleak menubar install',
    '  tokenleak menubar uninstall',
    '  tokenleak menubar status',
    '  tokenleak menubar refresh',
    '  tokenleak menubar open',
    '  tokenleak menubar start',
    '  tokenleak menubar stop',
    '',
  ].join('\n');
}

async function runRefresh(parsed: ParsedMenubarArgs): Promise<void> {
  const { paths } = resolveCommandConfig(parsed);
  const snapshot = await refreshMenubarSnapshot(paths);
  process.stdout.write(`Snapshot updated: ${snapshot.title}\n`);
}

async function runDaemon(parsed: ParsedMenubarArgs): Promise<void> {
  const { paths, config } = resolveCommandConfig(parsed);

  const tick = async () => {
    const snapshot = await refreshMenubarSnapshot(paths);
    process.stdout.write(`[menubar] ${formatTimestamp(snapshot.generatedAt)} ${snapshot.title}\n`);
  };

  await tick();
  if (parsed.once) {
    return;
  }

  const interval = setInterval(() => {
    void tick();
  }, config.pollIntervalSeconds * 1000);

  await new Promise<void>((resolve) => {
    const stop = () => {
      clearInterval(interval);
      resolve();
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

async function runClaudeStatusline(parsed: ParsedMenubarArgs): Promise<void> {
  const paths = resolveMenubarPaths(parsed.homeDir);
  await recordClaudeStatuslineSnapshot(paths);
}

export async function runMenubarCommand(argv: string[], cliEntrypoint: string): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.help || parsed.command === 'help') {
    process.stdout.write(buildMenubarHelpText());
    return;
  }

  switch (parsed.command) {
    case 'install': {
      const paths = await installMenubar(parsed.homeDir, cliEntrypoint);
      process.stdout.write(`Installed Tokenleak Usage at ${paths.installedAppPath}\n`);
      return;
    }
    case 'uninstall': {
      const paths = uninstallMenubar(parsed.homeDir);
      process.stdout.write(`Removed menubar install from ${paths.appSupportDir}\n`);
      return;
    }
    case 'status':
      printMenubarStatus(resolveMenubarPaths(parsed.homeDir));
      return;
    case 'refresh':
      await runRefresh(parsed);
      return;
    case 'open':
      openMenubarApp(resolveMenubarPaths(parsed.homeDir));
      return;
    case 'start':
      startMenubarApp(resolveMenubarPaths(parsed.homeDir));
      process.stdout.write('Started menubar app.\n');
      return;
    case 'stop':
      stopMenubarApp(resolveMenubarPaths(parsed.homeDir));
      process.stdout.write('Stopped menubar app.\n');
      return;
    case 'daemon':
      await runDaemon(parsed);
      return;
    case 'claude-statusline':
      await runClaudeStatusline(parsed);
      return;
    case 'open-dashboard':
      openDashboardInTerminal(resolveMenubarPaths(parsed.homeDir));
      return;
    default:
      throw new TokenleakError(`Unknown menubar command "${parsed.command}"`);
  }
}
