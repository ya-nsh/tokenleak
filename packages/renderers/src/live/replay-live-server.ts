import type { ReplayReport } from '@tokenleak/core';
import { generateReplayLiveHtml } from './replay-live-template';

export interface ReplayLiveServerOptions {
  port?: number;
  /**
   * Suppress the "Replay live at http://..." stderr line on successful start.
   * Set this when calling from a full-screen TUI process — the stderr write
   * corrupts the rendered screen and makes the terminal look frozen.
   */
  silent?: boolean;
}

/**
 * Heatmap-aware multi-day input. When a provider is passed instead of a
 * single ReplayReport, the page renders a 90-day heatmap above the cost
 * odometer and exposes `GET /api/replay?date=YYYY-MM-DD` for in-page
 * date switching.
 */
export interface ReplayLiveDataProvider {
  /** All days in the lookback window (most-recent first OK; the template sorts). */
  heatmap: ReplayHeatmapEntry[];
  /** Initial day rendered when the page loads. */
  initialDate: string;
  /** Initial day's already-built report (so the first paint is offline-fast). */
  initialReport: ReplayReport;
  /** Async lookup for date switching; return null when there are no events. */
  getReport: (date: string) => Promise<ReplayReport | null> | ReplayReport | null;
}

export interface ReplayHeatmapEntry {
  date: string;          // YYYY-MM-DD
  tokens: number;
  cost: number;
  events: number;
}

function isProvider(arg: ReplayReport | ReplayLiveDataProvider): arg is ReplayLiveDataProvider {
  return (arg as ReplayLiveDataProvider).getReport !== undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function makeEmptyReport(date: string): ReplayReport {
  return {
    date,
    events: [],
    flowBlocks: [],
    tokenVelocity: [],
    summary: {
      totalSessions: 0,
      totalEvents: 0,
      flowTimeMs: 0,
      thinkTimeMs: 0,
      flowThinkRatio: 0,
      peakMinute: null,
    },
  };
}

function tryServe(
  buildHandler: () => (req: Request) => Response | Promise<Response>,
  port: number,
): { server: ReturnType<typeof Bun.serve>; error: null } | { server: null; error: unknown } {
  try {
    const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: buildHandler() });
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
 * Start a local HTTP server that renders the interactive replay UI.
 * Finds a free port starting from the given port (default 3567).
 *
 * Single-day mode: pass a ReplayReport. Server has one route (`/`) and the
 * page renders without a heatmap.
 *
 * Multi-day mode: pass a ReplayLiveDataProvider. Server adds
 * `GET /api/replay?date=YYYY-MM-DD` returning JSON; the page renders a
 * GitHub-style heatmap above the cost odometer for in-page date switching.
 */
export async function startReplayLiveServer(
  arg: ReplayReport | ReplayLiveDataProvider,
  options: ReplayLiveServerOptions = {},
): Promise<{ port: number; stop: () => void }> {
  const startPort = options.port ?? 3567;
  const maxAttempts = 20;
  let port = startPort;

  const buildHandler = () => {
    if (isProvider(arg)) {
      // Multi-day mode: serve `/` with the day-specific report embedded (read
      // from `?date=` query, falling back to initialDate). Heatmap clicks just
      // navigate to `/?date=YYYY-MM-DD` — a full reload, but cheap on local
      // data and avoids needing a JS-side rebuild path. The /api/replay
      // endpoint stays around for future programmatic access.
      return async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        if (url.pathname === '/') {
          const requested = url.searchParams.get('date');
          let date = arg.initialDate;
          let report: ReplayReport | null = arg.initialReport;
          if (requested && ISO_DATE.test(requested) && requested !== arg.initialDate) {
            const fresh = await arg.getReport(requested);
            if (fresh) {
              date = requested;
              report = fresh;
            } else {
              report = makeEmptyReport(requested);
              date = requested;
            }
          }
          const html = generateReplayLiveHtml(report, {
            heatmap: arg.heatmap,
            initialDate: date,
          });
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        if (url.pathname === '/api/replay') {
          const date = url.searchParams.get('date') ?? '';
          if (!ISO_DATE.test(date)) {
            return Response.json({ error: 'invalid date — expected YYYY-MM-DD' }, { status: 400 });
          }
          const report = await arg.getReport(date);
          if (!report) {
            return Response.json({ error: 'no events for that date' }, { status: 404 });
          }
          return Response.json(report);
        }
        return new Response('not found', { status: 404 });
      };
    }
    const html = generateReplayLiveHtml(arg);
    return (_req: Request): Response =>
      new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = tryServe(buildHandler, port);
    if (result.server) {
      const actualPort = result.server.port ?? port;
      if (!options.silent) {
        process.stderr.write(
          `Replay live at http://localhost:${String(actualPort)}\n`,
        );
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
