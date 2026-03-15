/**
 * Backward-compatible renderProgressBar for existing tests.
 * Returns an ANSI progress bar string.
 */

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const GREEN = `${ESC}32m`;
const DIM = `${ESC}2m`;

const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

function color(text: string, code: string): string {
  return `${code}${text}${RESET}`;
}

export function renderProgressBar(frame: number, width: number, elapsedSeconds: number): string {
  const spinner = BRAILLE_SPINNER[frame % BRAILLE_SPINNER.length]!;
  const timeStr = `${elapsedSeconds}s`;
  const prefix = `${spinner} Working... [`;
  const suffix = `] ${timeStr}`;
  const chromeWidth = prefix.length + suffix.length;
  const barWidth = Math.max(8, width - chromeWidth);
  const cycle = barWidth * 2;
  const position = frame % cycle;
  const fillCount = position <= barWidth ? position : cycle - position;
  const filled = '\u2588'.repeat(fillCount);
  const empty = '\u2591'.repeat(barWidth - fillCount);

  return `${color(spinner, GREEN)} Working... [${color(filled, GREEN)}${color(empty, DIM)}] ${color(timeStr, DIM)}`;
}
