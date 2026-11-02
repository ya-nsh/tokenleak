/** Process-wide output preferences that every subcommand shares. */

const DEFAULT_WIDTH = 80;
const MIN_AUTO_WIDTH = 40;
/** Wider than this, dashboards stop gaining information and just stretch. */
const MAX_AUTO_WIDTH = 140;
const GLOBAL_VERBOSE_FLAGS = new Set(['--verbose']);

let verbose = process.env['TOKENLEAK_VERBOSE'] === '1';

export function isVerbose(): boolean {
  return verbose;
}

export function setVerbose(value: boolean): void {
  verbose = value;
}

/**
 * Remove flags that apply to every command before a subcommand parser sees
 * them, so `--verbose` works everywhere without each parser learning it.
 */
export function extractGlobalFlags(argv: readonly string[]): { argv: string[]; verbose: boolean } {
  const rest: string[] = [];
  let sawVerbose = false;
  for (const arg of argv) {
    if (GLOBAL_VERBOSE_FLAGS.has(arg)) sawVerbose = true;
    else rest.push(arg);
  }
  return { argv: rest, verbose: sawVerbose };
}

interface StreamLike {
  isTTY?: boolean;
  columns?: number;
}

/**
 * Whether to emit ANSI color, following https://no-color.org and the common
 * FORCE_COLOR convention. Piped or redirected output defaults to plain text.
 */
export function shouldUseColor(
  stream: StreamLike = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  const force = env['FORCE_COLOR'];
  if (force !== undefined && force !== '' && force !== '0' && force !== 'false') return true;
  return stream.isTTY === true;
}

/** Render width for terminal output: the real terminal, clamped, or 80 when piped. */
export function defaultTerminalWidth(stream: StreamLike = process.stdout): number {
  if (stream.isTTY !== true || typeof stream.columns !== 'number' || stream.columns <= 0) {
    return DEFAULT_WIDTH;
  }
  return Math.min(MAX_AUTO_WIDTH, Math.max(MIN_AUTO_WIDTH, stream.columns));
}
