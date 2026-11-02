import type { ArgsDef } from 'citty';
import { TokenleakError } from './errors.js';

/** Edits allowed between a typo and the flag we suggest instead. */
const MAX_SUGGESTION_DISTANCE = 2;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Every spelling citty accepts for the flags in `args`. */
export function knownFlagsFor(args: ArgsDef): Set<string> {
  const known = new Set<string>(['--help', '-h', '--version', '-v']);
  for (const [name, def] of Object.entries(args)) {
    if (def.type === 'positional') continue;
    known.add(`--${name}`);
    known.add(`--${kebab(name)}`);
    if (def.type === 'boolean') {
      known.add(`--no-${kebab(name)}`);
    }
    const aliases = 'alias' in def && def.alias !== undefined ? [def.alias].flat() : [];
    for (const alias of aliases) {
      known.add(alias.length === 1 ? `-${alias}` : `--${alias}`);
    }
  }
  return known;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!;
      previous[j] = Math.min(
        above + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

/** The closest known long flag to a typo, if one is close enough to be meant. */
export function suggestFlag(unknown: string, known: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = MAX_SUGGESTION_DISTANCE + 1;
  for (const candidate of known) {
    // Suggest the documented kebab-case spelling, not citty's camelCase twin.
    if (!candidate.startsWith('--') || /[A-Z]/.test(candidate)) continue;
    const distance = editDistance(unknown, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** The first flag-shaped argument that `known` does not contain. */
export function findUnknownFlag(argv: readonly string[], known: ReadonlySet<string>): string | undefined {
  for (const arg of argv) {
    if (arg === '--') return undefined;
    // Values (dates, paths, provider lists) and negative numbers are not flags.
    if (!arg.startsWith('-') || /^-\d/.test(arg)) continue;
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (!known.has(name)) return name;
  }
  return undefined;
}

/**
 * Reject flags a command does not define. citty silently ignores them, which
 * turned typos like `--day 30` into a 90-day report with exit code 0.
 */
export function assertKnownFlags(argv: readonly string[], args: ArgsDef, command: string): void {
  const known = knownFlagsFor(args);
  const unknown = findUnknownFlag(argv, known);
  if (unknown === undefined) return;
  const suggestion = suggestFlag(unknown, known);
  throw new TokenleakError(
    `Unknown flag "${unknown}" for \`${command}\`.` +
      (suggestion ? ` Did you mean "${suggestion}"?` : '') +
      `\nUsage: ${command} [flags]\nRun \`${command} --help\` to see every flag.`,
  );
}
