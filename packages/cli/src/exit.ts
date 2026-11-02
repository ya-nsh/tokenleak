import { cancelBackgroundPricingRefresh } from '@tokenleak/registry';

/** Upper bound for a stray handle (socket, timer) to hold a finished command open. */
const FORCED_EXIT_GRACE_MS = 10_000;

/**
 * Finish a command with `code` without truncating piped output.
 *
 * `process.exit()` drops whatever stdout has not handed to the pipe yet, and
 * Bun gives no reliable "flushed" signal for pipes. So instead this sets the
 * exit code, stops background work, and lets the caller return: the process
 * exits once the event loop (including pending stdout) drains. An unref'd
 * timer forces the exit if a stray handle never closes.
 */
export function finishCommand(code: number): void {
  process.exitCode = code;
  cancelBackgroundPricingRefresh();
  setTimeout(() => process.exit(code), FORCED_EXIT_GRACE_MS).unref();
}
