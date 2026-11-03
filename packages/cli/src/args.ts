import type { ArgsDef } from 'citty';
import { TokenleakError } from './errors.js';
import { assertKnownFlags } from './flag-validation.js';
import { buildVersionText } from './report-output.js';

function normalizeCliArg(arg: string): string {
  const flagMap: Record<string, string> = {
    '--all-providers': '--allProviders',
    '--list-providers': '--listProviders',
    '--open-code': '--openCode',
    '--live-server': '--liveServer',
    '--wrapped-live': '--wrappedLive',
    '--no-color': '--noColor',
    '--no-insights': '--noInsights',
    '--include-prompts': '--includePrompts',
  };

  return flagMap[arg] ?? arg;
}

export function normalizeCliArgv(argv: string[]): string[] {
  const normalized = argv.map(normalizeCliArg);
  const result: string[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const arg = normalized[i]!;

    if (arg === '--provider' || arg === '-p') {
      result.push(arg);

      const providerParts: string[] = [];
      let j = i + 1;
      while (j < normalized.length) {
        const next = normalized[j]!;
        if (next.startsWith('-')) break;
        providerParts.push(next);
        j++;
      }

      if (providerParts.length > 0) {
        result.push(providerParts.join(' '));
        i = j - 1;
      }

      continue;
    }

    result.push(arg);
  }

  return result;
}

export function parseOptimizationArgs(argv: string[]): Record<string, unknown> {
  const cliArgs: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (!value) throw new TokenleakError(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case '--help':
      case '-h':
        cliArgs['help'] = true;
        break;
      case '--version':
      case '-v':
        cliArgs['version'] = true;
        break;
      case '--format':
      case '-f':
        cliArgs['format'] = next();
        break;
      case '--since':
      case '-s':
        cliArgs['since'] = next();
        break;
      case '--until':
      case '-u':
        cliArgs['until'] = next();
        break;
      case '--days':
      case '-d':
        cliArgs['days'] = Number(next());
        break;
      case '--output':
      case '-o':
        cliArgs['output'] = next();
        break;
      case '--width':
      case '-w':
        cliArgs['width'] = Number(next());
        break;
      case '--provider':
      case '-p':
        cliArgs['provider'] = next();
        break;
      case '--model':
        cliArgs['model'] = next();
        break;
      case '--project':
        cliArgs['project'] = next();
        break;
      case '--repo':
        cliArgs['repo'] = next();
        break;
      case '--strategy':
        cliArgs['strategy'] = next();
        break;
      case '--severity':
        cliArgs['severity'] = next();
        break;
      case '--include-prompts':
      case '--includePrompts':
        cliArgs['includePrompts'] = true;
        break;
      case '--claude':
        cliArgs['claude'] = true;
        break;
      case '--codex':
        cliArgs['codex'] = true;
        break;
      case '--cursor':
        cliArgs['cursor'] = true;
        break;
      case '--pi':
        cliArgs['pi'] = true;
        break;
      case '--openCode':
      case '--open-code':
        cliArgs['openCode'] = true;
        break;
      case '--allProviders':
      case '--all-providers':
        cliArgs['allProviders'] = true;
        break;
      case '--listProviders':
      case '--list-providers':
        cliArgs['listProviders'] = true;
        break;
      case '--noColor':
      case '--no-color':
        cliArgs['noColor'] = true;
        break;
      default:
        throw new TokenleakError(`Unknown flag "${arg}". Run the command with --help for usage.`);
    }
  }
  return cliArgs;
}

/** citty ignores unknown flags; check them against the command's own definition. */
export async function validateCommandFlags(
  command: { args?: unknown },
  argv: readonly string[],
  name: string,
): Promise<void> {
  const resolved = typeof command.args === 'function' ? await command.args() : await command.args;
  assertKnownFlags(argv, (resolved ?? {}) as ArgsDef, name);
}

/** The `--help`/`--version` flags present in raw argv, for commands parsed by citty. */
export function infoFlagsFromArgv(argv: readonly string[]): Record<string, unknown> {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    version: argv.includes('--version') || argv.includes('-v'),
  };
}

/**
 * Answer `--help` or `--version` for a subcommand. Returns true when one was
 * printed, so the caller stops before loading any data.
 */
export function printInfoFlag(cliArgs: Record<string, unknown>, buildHelp: () => string): boolean {
  if (cliArgs['help']) {
    process.stdout.write(buildHelp());
    return true;
  }
  if (cliArgs['version']) {
    process.stdout.write(buildVersionText());
    return true;
  }
  return false;
}
