/**
 * Upload content to a GitHub Gist using the `gh` CLI.
 */

/**
 * Check whether the `gh` CLI is available and authenticated.
 * Returns true if `gh auth status` exits successfully.
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['gh', 'auth', 'status'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Upload content to a GitHub Gist.
 *
 * Creates a temporary file, uploads it via `gh gist create`, and returns
 * the URL of the created gist.
 *
 * @param content - The content to upload
 * @param filename - The filename for the gist (e.g., "tokenleak.json")
 * @param description - A short description for the gist
 * @returns The URL of the created gist
 * @throws If `gh` CLI is not available or the upload fails
 */
export async function uploadToGist(
  content: string,
  filename: string,
  description: string,
): Promise<string> {
  const available = await isGhAvailable();
  if (!available) {
    throw new Error(
      'GitHub CLI (gh) is not installed or not authenticated. ' +
        'Install it from https://cli.github.com and run `gh auth login`.',
    );
  }

  // Write content to a temp file
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { writeFileSync, unlinkSync } = await import('node:fs');

  const tmpPath = join(tmpdir(), `tokenleak-gist-${Date.now()}-${filename}`);
  writeFileSync(tmpPath, content, 'utf-8');

  try {
    const proc = Bun.spawn(
      ['gh', 'gist', 'create', tmpPath, '--desc', description, '--public'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const exitCode = await proc.exited;
    const stdout = (await new Response(proc.stdout).text()).trim();
    const stderr = (await new Response(proc.stderr).text()).trim();

    if (exitCode !== 0) {
      throw new Error(
        `Failed to create gist: ${stderr || 'unknown error'} (exit code ${exitCode})`,
      );
    }

    // gh gist create prints the URL to stdout
    if (!stdout.startsWith('http')) {
      throw new Error(`Unexpected gh output: ${stdout}`);
    }

    return stdout;
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
