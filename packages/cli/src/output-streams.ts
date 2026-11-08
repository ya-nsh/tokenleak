/**
 * Handling of errors on the process's own output streams.
 *
 * Node-style streams report a failed write as an `'error'` event; with no
 * listener, Bun turns it into an uncaught exception and a stack trace. The
 * common case is a reader that stops early (`tokenleak --format json | head`),
 * which closes the pipe and fails the next write with `EPIPE`.
 */

/** The error code of a write to a pipe whose reader has gone away. */
const BROKEN_PIPE = 'EPIPE';
/** Exit status for a broken pipe when nothing else failed: the reader chose to stop, not an error. */
const BROKEN_PIPE_EXIT_CODE = 0;
/** Exit status when output could not be written for any other reason. */
const OUTPUT_FAILURE_EXIT_CODE = 1;

export type OutputStreamName = 'stdout' | 'stderr';

/** What to do about an error on one of the output streams. */
export interface OutputErrorAction {
  exitCode: number;
  /** A message for stderr, or `null` when there is nothing to say or nowhere to say it. */
  message: string | null;
}

interface ErrorEmitter {
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

export interface OutputStreamDeps {
  stdout: ErrorEmitter;
  stderr: ErrorEmitter;
  /** Writes a message to stderr; it must not throw. */
  reportError: (message: string) => void;
  /** The exit status already set by the command, if any. */
  currentExitCode: () => number | undefined;
  exit: (code: number) => void;
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Whether `error` means the reader on the other end of the stream has closed it. */
export function isBrokenPipe(error: unknown): boolean {
  return errorCode(error) === BROKEN_PIPE;
}

/**
 * Decide how to end the process after an output stream fails.
 *
 * A broken pipe keeps any failure the command already recorded and otherwise
 * exits 0, since nothing further can be delivered and nothing went wrong.
 * Any other write failure (a full disk behind a redirect, an I/O error) is a
 * real failure: it exits 1, and says so unless stderr itself is what failed.
 */
export function outputErrorAction(
  stream: OutputStreamName,
  error: unknown,
  currentExitCode: number | undefined,
): OutputErrorAction {
  if (isBrokenPipe(error)) {
    const exitCode = currentExitCode !== undefined && currentExitCode !== 0 ? currentExitCode : BROKEN_PIPE_EXIT_CODE;
    return { exitCode, message: null };
  }
  return {
    exitCode: OUTPUT_FAILURE_EXIT_CODE,
    message:
      stream === 'stderr'
        ? null
        : `Error: could not write output to ${stream}: ${errorText(error)}. Check that the destination is writable.\n`,
  };
}

function numericExitCode(): number | undefined {
  const code = process.exitCode;
  if (typeof code === 'number') return code;
  if (typeof code === 'string' && /^\d+$/.test(code)) return Number(code);
  return undefined;
}

const defaultDeps: OutputStreamDeps = {
  stdout: process.stdout,
  stderr: process.stderr,
  reportError: (message) => {
    try {
      process.stderr.write(message);
    } catch {
      // Nowhere left to report it.
    }
  },
  currentExitCode: numericExitCode,
  exit: (code) => process.exit(code),
};

/**
 * End the process cleanly when stdout or stderr fails, instead of crashing
 * with a stack trace. Exiting at once is right here: the output that
 * `finishCommand` waits to drain can no longer be delivered.
 */
export function guardOutputStreams(deps: OutputStreamDeps = defaultDeps): void {
  const handle = (stream: OutputStreamName) => (error: unknown) => {
    const action = outputErrorAction(stream, error, deps.currentExitCode());
    if (action.message !== null) deps.reportError(action.message);
    deps.exit(action.exitCode);
  };
  deps.stdout.on('error', handle('stdout'));
  deps.stderr.on('error', handle('stderr'));
}
