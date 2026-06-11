import type { BlackBoxTrace } from '@tokenleak/core';
import { generateBlackBoxLiveHtml } from './blackbox-live-template';

export interface BlackBoxLiveServerOptions {
  port?: number;
  silent?: boolean;
}

export interface BlackBoxLiveDataProvider {
  initialTargetIndex: number;
  initialTrace: BlackBoxTrace;
  getTrace: (targetIndex: number) => Promise<BlackBoxTrace | null> | BlackBoxTrace | null;
}

function tryServe(
  buildHandler: () => (req: Request) => Response | Promise<Response>,
  port: number,
): { server: ReturnType<typeof Bun.serve>; error: null } | { server: null; error: unknown } {
  try {
    const server = Bun.serve({ port, fetch: buildHandler() });
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

function parseTargetIndex(url: URL, fallback: number): number {
  const raw = url.searchParams.get('target');
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function startBlackBoxLiveServer(
  provider: BlackBoxLiveDataProvider,
  options: BlackBoxLiveServerOptions = {},
): Promise<{ port: number; stop: () => void }> {
  const startPort = options.port ?? 3666;
  const maxAttempts = 20;
  let port = startPort;

  const buildHandler = () => async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === '/') {
      const targetIndex = parseTargetIndex(url, provider.initialTargetIndex);
      const trace = targetIndex === provider.initialTargetIndex
        ? provider.initialTrace
        : await provider.getTrace(targetIndex);
      const html = generateBlackBoxLiveHtml(trace ?? provider.initialTrace, { targetIndex });
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname === '/api/blackbox') {
      const targetIndex = parseTargetIndex(url, provider.initialTargetIndex);
      const trace = targetIndex === provider.initialTargetIndex
        ? provider.initialTrace
        : await provider.getTrace(targetIndex);
      if (!trace) {
        return Response.json({ error: 'trace target not found' }, { status: 404 });
      }
      return Response.json(trace);
    }

    return new Response('not found', { status: 404 });
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = tryServe(buildHandler, port);
    if (result.server) {
      const actualPort = result.server.port ?? port;
      if (!options.silent) {
        process.stderr.write(`Black Box graph at http://localhost:${String(actualPort)}\n`);
      }
      return { port: actualPort, stop: () => result.server.stop(true) };
    }

    if (isAddrInUse(result.error)) {
      port++;
      continue;
    }

    throw result.error;
  }

  throw new Error(
    `Could not find a free port after ${maxAttempts} attempts starting from ${startPort}`,
  );
}
