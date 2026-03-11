import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Open a URL in the default browser.
 *
 * Uses `open` on macOS and `xdg-open` on Linux.
 *
 * @param url - The URL to open
 * @throws Error if the open command fails or the platform is unsupported
 */
export async function openInBrowser(url: string): Promise<void> {
  const os = platform();
  let command: string;

  switch (os) {
    case 'darwin':
      command = 'open';
      break;
    case 'linux':
      command = 'xdg-open';
      break;
    default:
      throw new Error(`Browser open not supported on platform: ${os}`);
  }

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, [url], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Failed to open browser (exit code ${code}): ${stderr.trim()}`,
          ),
        );
      }
    });

    proc.on('error', (err) => {
      reject(
        new Error(
          `Failed to run "${command}": ${err.message}`,
        ),
      );
    });
  });
}
