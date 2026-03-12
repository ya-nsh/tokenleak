import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import { generateHtml } from './template';

export interface LiveServerOptions extends RenderOptions {
  port?: number;
}

function tryServe(
  html: string,
  port: number,
): { server: ReturnType<typeof Bun.serve>; error: null } | { server: null; error: unknown } {
  try {
    const server = Bun.serve({
      port,
      fetch(_req: Request): Response {
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    });
    return { server, error: null };
  } catch (err: unknown) {
    return { server: null, error: err };
  }
}

function isAddrInUse(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (obj['code'] === 'EADDRINUSE') return true;
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes('EADDRINUSE') || msg.includes('address already in use')) return true;
  }
  return false;
}

/**
 * Start a local HTTP server that renders the terminal card as an interactive HTML page.
 * Finds a free port starting from the given port (default 3333).
 */
export async function startLiveServer(
  output: TokenleakOutput,
  options: LiveServerOptions,
): Promise<{ port: number; stop: () => void }> {
  const html = generateHtml(output, options);
  const startPort = options.port ?? 3333;
  const maxAttempts = 20;

  let port = startPort;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = tryServe(html, port);
    if (result.server) {
      const actualPort = result.server.port ?? port;
      process.stderr.write(`Server running at http://localhost:${String(actualPort)}\n`);
      return { port: actualPort, stop: () => result.server.stop(true) };
    }

    if (isAddrInUse(result.error)) {
      port++;
      continue;
    }

    throw result.error;
  }

  throw new Error(`Could not find a free port after ${maxAttempts} attempts starting from ${startPort}`);
}
