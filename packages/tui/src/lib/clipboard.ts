const PLATFORM_COMMANDS: Record<string, readonly string[]> = {
  darwin: ['pbcopy'],
  linux: ['xclip', '-selection', 'clipboard'],
  win32: ['clip'],
};

export async function copyTextToClipboard(
  content: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const command = PLATFORM_COMMANDS[platform];
  if (!command) {
    throw new Error(`Clipboard is not supported on platform "${platform}".`);
  }

  const [cmd, ...args] = command;
  const proc = Bun.spawn([cmd!, ...args], {
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'pipe',
  });

  proc.stdin.write(content);
  proc.stdin.end();

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Clipboard command "${cmd}" failed: ${stderr.trim()}`);
  }
}
