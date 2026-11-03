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
import { buildHelpText, main } from './commands/report.js';
import { simulateRoutingCommand } from './commands/simulate-routing.js';
import { statuslineCommand } from './commands/statusline.js';
import { wasteCommand } from './commands/waste.js';
import { handleError } from './errors.js';
import { finishCommand } from './exit.js';
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

/** The default command: the TUI in a terminal, otherwise a rendered report. */
async function runDefaultCommand(argv: string[]): Promise<void> {
  process.argv = [...process.argv.slice(0, 2), ...argv];
  if (printInfoFlag(infoFlagsFromArgv(argv), buildHelpText)) return;

  // Every path prices usage, so a broken override file must stop the run up front.
  await initPricing();

  if (shouldStartTui(argv, Boolean(process.stdin.isTTY), Boolean(process.stdout.isTTY))) {
    const { main: startTui } = await import('@tokenleak/tui');
    await startTui();
    return;
  }

  await validateCommandFlags(main, argv, 'tokenleak');
  const mainArgs = typeof main.args === 'function' ? await main.args() : await main.args;
  assertNoStrayPositional(argv, (mainArgs ?? {}) as ArgsDef, 'tokenleak', [...SUBCOMMANDS.keys()]);
  await runMain(main);
}

/**
 * Parse argv and run one command. Commands return after setting the exit
 * code instead of calling process.exit(), so piped output is never cut off.
 */
async function dispatchCli(): Promise<void> {
  const globals = extractGlobalFlags(process.argv.slice(2));
  if (globals.verbose) setVerbose(true);
  const argv = normalizeCliArgv(globals.argv);

  const subcommand = argv[0] !== undefined ? SUBCOMMANDS.get(argv[0]) : undefined;
  try {
    if (subcommand) {
      await subcommand(argv.slice(1));
    } else {
      await runDefaultCommand(argv);
    }
  } catch (error: unknown) {
    handleError(error);
  }
  finishCommand(0);
}

if (isDirectExecution) {
  await dispatchCli();
}
