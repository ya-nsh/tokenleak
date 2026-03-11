/**
 * Open a file in the default application using platform-specific commands.
 */

const PLATFORM_COMMANDS: Record<string, string> = {
  darwin: 'open',
  linux: 'xdg-open',
  win32: 'start',
};

/**
 * Returns the open command for the current platform.
 * Throws if the platform is unsupported.
 */
export function getOpenCommand(
  platform: NodeJS.Platform = process.platform,
): string {
  const command = PLATFORM_COMMANDS[platform];
  if (!command) {
    throw new Error(
      `Opening files is not supported on platform "${platform}". Supported: macOS, Linux, Windows.`,
    );
  }
  return command;
}

/**
 * Open a file in the default application.
 *
 * Uses `open` on macOS, `xdg-open` on Linux, and `start` on Windows.
 * Throws if the command fails or the platform is unsupported.
 */
export async function openFile(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const cmd = getOpenCommand(platform);

  // On Windows, `start` is a shell builtin so we need cmd.exe
  const spawnArgs =
    platform === 'win32' ? ['cmd', '/c', 'start', '', filePath] : [cmd, filePath];

  const proc = Bun.spawn(spawnArgs, {
    stdout: 'ignore',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to open "${filePath}" with "${cmd}": exit code ${exitCode}: ${stderr.trim()}`,
    );
  }
}
