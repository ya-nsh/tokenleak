/**
 * Copy content to the system clipboard using platform-specific commands.
 */

const PLATFORM_COMMANDS: Record<string, readonly string[]> = {
  darwin: ['pbcopy'],
  linux: ['xclip', '-selection', 'clipboard'],
  win32: ['clip'],
};

/**
 * Returns the clipboard command for the current platform.
 * Throws if the platform is unsupported.
 */
export function getClipboardCommand(
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  const command = PLATFORM_COMMANDS[platform];
  if (!command) {
    throw new Error(
      `Clipboard is not supported on platform "${platform}". Supported: macOS, Linux, Windows.`,
    );
  }
  return command;
}

/**
 * Copy a string to the system clipboard.
 *
 * Uses `pbcopy` on macOS, `xclip` on Linux, and `clip` on Windows.
 * Throws if the clipboard command fails or the platform is unsupported.
 */
export async function copyToClipboard(
  content: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const [cmd, ...args] = getClipboardCommand(platform);

  const proc = Bun.spawn([cmd, ...args], {
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'pipe',
  });

  proc.stdin.write(content);
  proc.stdin.end();

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Clipboard command "${cmd}" failed with exit code ${exitCode}: ${stderr.trim()}`,
    );
  }
}
