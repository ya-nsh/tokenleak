/** Bare `tokenleak` in an interactive terminal opens the TUI; anything else renders once. */
export function shouldStartTui(argv: readonly string[], stdinIsTTY: boolean, stdoutIsTTY: boolean): boolean {
  return argv.length === 0 && stdinIsTTY && stdoutIsTTY;
}
