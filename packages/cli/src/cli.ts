#!/usr/bin/env bun
import { runMain } from 'citty';
import type { ArgsDef } from 'citty';
import { initPricing } from '@tokenleak/registry';
import {
  infoFlagsFromArgv,
  normalizeCliArgv,
  printInfoFlag,
  validateCommandFlags,
} from './args.js';
import { behaviorDiffCommand } from './commands/behavior-diff.js';
import { commonsCommand } from './commands/commons.js';
import { cursorCommand } from './commands/cursor.js';
import { explainCommand } from './commands/explain.js';
import { focusCommand } from './commands/focus.js';
import { nutritionCommand } from './commands/nutrition.js';
import { pricingCommand } from './commands/pricing.js';
import { receiptsCommand } from './commands/receipts.js';
import { replayCommand } from './commands/replay.js';
import { serveCommand } from './commands/serve.js';
import { buildHelpText, main } from './commands/report.js';
import { simulateRoutingCommand } from './commands/simulate-routing.js';
import { statuslineCommand } from './commands/statusline.js';
import { wasteCommand } from './commands/waste.js';
import { handleError } from './errors.js';
import { finishCommand } from './exit.js';
import { guardOutputStreams } from './output-streams.js';
import { assertNoStrayPositional } from './flag-validation.js';
import { extractGlobalFlags, setVerbose } from './output-mode.js';
import { shouldStartTui } from './tui-launch.js';
import { runUsage } from './usage.js';

/** A subcommand entry point; `argv` is everything after the subcommand name. */
type SubcommandHandler = (argv: string[]) => Promise<void>;

/** Every subcommand, dispatched before the main report command. */
const SUBCOMMANDS: ReadonlyMap<string, SubcommandHandler> = new Map([
  ['behavior-diff', behaviorDiffCommand],
  ['commons', commonsCommand],
  ['cursor', cursorCommand],
  ['explain', explainCommand],
  ['focus', focusCommand],
  ['nutrition', nutritionCommand],
  ['pricing', pricingCommand],
  ['receipts', receiptsCommand],
  ['replay', replayCommand],
  ['serve', serveCommand],
  ['simulate-routing', simulateRoutingCommand],
  ['statusline', statuslineCommand],
  ['usage', runUsage],
  ['waste', wasteCommand],
]);

// Only run when executed directly, not when imported by tests
const isDirectExecution =
  typeof Bun !== 'undefined'
    ? Bun.main === import.meta.path
    : process.argv[1] !== undefined &&
      import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

/**
 * How a command ended. `finished` commands let the process exit once output
 * drains; an `interactive` one (the TUI) keeps running until the user quits.
 */
export type CommandOutcome = 'finished' | 'interactive';

export interface DefaultCommandDeps {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  /** Starts the TUI and resolves once it is on screen, not when it closes. */
  startTui: () => Promise<void>;
}

const defaultCommandDeps: DefaultCommandDeps = {
  stdinIsTTY: Boolean(process.stdin.isTTY),
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  startTui: async () => {
    const { main: startTui } = await import('@tokenleak/tui');
    await startTui();
  },
};

/** The default command: the TUI in a terminal, otherwise a rendered report. */
export async function runDefaultCommand(
  argv: string[],
  deps: DefaultCommandDeps = defaultCommandDeps,
): Promise<CommandOutcome> {
  process.argv = [...process.argv.slice(0, 2), ...argv];
  if (printInfoFlag(infoFlagsFromArgv(argv), buildHelpText)) return 'finished';

  // Every path prices usage, so a broken override file must stop the run up front.
  await initPricing();

  if (shouldStartTui(argv, deps.stdinIsTTY, deps.stdoutIsTTY)) {
    await deps.startTui();
    return 'interactive';
  }

  await validateCommandFlags(main, argv, 'tokenleak');
  const mainArgs = typeof main.args === 'function' ? await main.args() : await main.args;
  assertNoStrayPositional(argv, (mainArgs ?? {}) as ArgsDef, 'tokenleak', [...SUBCOMMANDS.keys()]);
  await runMain(main);
  return 'finished';
}

/**
 * Parse argv and run one command. Commands return after setting the exit
 * code instead of calling process.exit(), so piped output is never cut off.
 */
async function dispatchCli(): Promise<void> {
  // A reader that stops early (`tokenleak --format json | head`) must not crash the CLI.
  guardOutputStreams();
  const globals = extractGlobalFlags(process.argv.slice(2));
  if (globals.verbose) setVerbose(true);
  const argv = normalizeCliArgv(globals.argv);

  const subcommand = argv[0] !== undefined ? SUBCOMMANDS.get(argv[0]) : undefined;
  let outcome: CommandOutcome = 'finished';
  try {
    if (subcommand) {
      await subcommand(argv.slice(1));
    } else {
      outcome = await runDefaultCommand(argv);
    }
  } catch (error: unknown) {
    handleError(error);
  }
  // finishCommand arms a forced exit, which would kill a TUI that is still open.
  if (outcome === 'finished') finishCommand(0);
}

if (isDirectExecution) {
  await dispatchCli();
}
