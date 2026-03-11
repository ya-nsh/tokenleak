import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Copy content to the system clipboard.
 *
 * Uses `pbcopy` on macOS and `xclip -selection clipboard` on Linux.
 *
 * @param content - The text content to copy
 * @throws Error if the clipboard command fails or the platform is unsupported
 */
export async function copyToClipboard(content: string): Promise<void> {
  const os = platform();
  let command: string;
  let args: string[];

  switch (os) {
    case 'darwin':
      command = 'pbcopy';
      args = [];
      break;
    case 'linux':
      command = 'xclip';
      args = ['-selection', 'clipboard'];
      break;
    default:
      throw new Error(`Clipboard not supported on platform: ${os}`);
  }

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
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
            `Clipboard command "${command}" exited with code ${code}: ${stderr.trim()}`,
          ),
        );
      }
    });

    proc.on('error', (err) => {
      reject(
        new Error(
          `Failed to run clipboard command "${command}": ${err.message}`,
        ),
      );
    });

    proc.stdin.write(content);
    proc.stdin.end();
  });
}
