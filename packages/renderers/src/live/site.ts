import type { RenderOptions, ReplayReport, TokenleakOutput } from '@tokenleak/core';
import { generateHtml } from './template';
import { generateWrappedLiveHtml } from './wrapped-live-template';
import { generateReplayLiveHtml } from './replay-live-template';
import {
  isReplayLiveDataProvider,
  makeEmptyReplayReport,
  type ReplayLiveDataProvider,
} from './replay-data';

/** First port tried when none is requested; later ports are tried while it is taken. */
export const DEFAULT_LIVE_PORT = 3333;
/** How many consecutive ports to try before giving up. */
const MAX_PORT_ATTEMPTS = 20;
/** Live pages are for this machine only, never the local network. */
const LOOPBACK_HOST = '127.0.0.1';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

/** Every page the live site can serve, by name. */
export const LIVE_ROUTES = {
  dashboard: '/dashboard',
  wrapped: '/wrapped',
  replay: '/replay',
} as const;
export type LiveRoute = keyof typeof LIVE_ROUTES;
const REPLAY_API_PATH = '/api/replay';

const ROUTE_TITLES: Record<LiveRoute, string> = {
  dashboard: 'Dashboard',
  wrapped: 'AI Wrapped',
  replay: 'Replay',
};

/** The data behind each page. A page whose data is missing is not served. */
export interface LiveSiteContent {
  dashboard?: { output: TokenleakOutput; options: RenderOptions };
  wrapped?: TokenleakOutput;
  /** One day's report, or a heatmap-backed provider for date switching. */
  replay?: ReplayReport | ReplayLiveDataProvider;
}

export interface LiveSiteOptions {
  /** Port to try first; `0` picks any free port. Defaults to {@link DEFAULT_LIVE_PORT}. */
  port?: number;
}

export interface LiveSite {
  port: number;
  /** Absolute URL of a page, or of the index when no route is given. */
  url: (route?: LiveRoute) => string;
  /** Pages the site currently serves. */
  routes: () => LiveRoute[];
  /** Add or replace page data on the running server. */
  update: (content: LiveSiteContent) => void;
  stop: () => void;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: HTML_HEADERS });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function availableRoutes(content: LiveSiteContent): LiveRoute[] {
  return (Object.keys(LIVE_ROUTES) as LiveRoute[]).filter((route) => content[route] !== undefined);
}

/** Landing page linking every page the site serves. */
export function generateLiveIndexHtml(routes: readonly LiveRoute[]): string {
  const links = routes
    .map(
      (route) =>
        `<li><a href="${LIVE_ROUTES[route]}">${escapeHtml(ROUTE_TITLES[route])}</a> <code>${LIVE_ROUTES[route]}</code></li>`,
    )
    .join('');
  const body = routes.length > 0 ? `<ul>${links}</ul>` : '<p>No pages have data yet.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>tokenleak</title>
<style>
body { background: #0a0a0a; color: #ededed; font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 48px 16px; }
main { max-width: 560px; margin: 0 auto; }
h1 { font-size: 18px; margin: 0 0 24px; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
a { color: #10b981; text-decoration: none; font-weight: 600; }
a:hover { text-decoration: underline; }
code { color: #888; margin-left: 8px; }
</style>
</head>
<body><main><h1>tokenleak</h1>${body}</main></body>
</html>`;
}

/** Page HTML that only depends on the content, built on first request and kept until the next update. */
interface PageCache {
  dashboard?: string;
  wrapped?: string;
  replay?: string;
}

async function serveReplay(
  replay: ReplayReport | ReplayLiveDataProvider,
  url: URL,
  cache: PageCache,
): Promise<Response> {
  if (!isReplayLiveDataProvider(replay)) {
    cache.replay ??= generateReplayLiveHtml(replay, { basePath: LIVE_ROUTES.replay });
    return html(cache.replay);
  }
  // Heatmap clicks navigate to `?date=YYYY-MM-DD`: a full reload, cheap on local data.
  const requested = url.searchParams.get('date');
  if (!requested || !ISO_DATE.test(requested) || requested === replay.initialDate) {
    cache.replay ??= generateReplayLiveHtml(replay.initialReport, {
      heatmap: replay.heatmap,
      initialDate: replay.initialDate,
      basePath: LIVE_ROUTES.replay,
    });
    return html(cache.replay);
  }
  const report = (await replay.getReport(requested)) ?? makeEmptyReplayReport(requested);
  return html(
    generateReplayLiveHtml(report, {
      heatmap: replay.heatmap,
      initialDate: requested,
      basePath: LIVE_ROUTES.replay,
    }),
  );
}

async function serveReplayApi(
  replay: ReplayReport | ReplayLiveDataProvider,
  url: URL,
): Promise<Response> {
  const date = url.searchParams.get('date') ?? '';
  if (!ISO_DATE.test(date)) {
    return Response.json({ error: 'invalid date — expected YYYY-MM-DD' }, { status: 400 });
  }
  const report = isReplayLiveDataProvider(replay)
    ? await replay.getReport(date)
    : replay.date === date
      ? replay
      : null;
  if (!report) {
    return Response.json({ error: 'no events for that date' }, { status: 404 });
  }
  return Response.json(report);
}

function createHandler(state: { content: LiveSiteContent; cache: PageCache }) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const { content, cache } = state;
    switch (url.pathname) {
      case '/':
        return html(generateLiveIndexHtml(availableRoutes(content)));
      case LIVE_ROUTES.dashboard:
        if (!content.dashboard) break;
        cache.dashboard ??= generateHtml(content.dashboard.output, content.dashboard.options);
        return html(cache.dashboard);
      case LIVE_ROUTES.wrapped:
        if (!content.wrapped) break;
        cache.wrapped ??= generateWrappedLiveHtml(content.wrapped);
        return html(cache.wrapped);
      case LIVE_ROUTES.replay:
        if (!content.replay) break;
        return serveReplay(content.replay, url, cache);
      case REPLAY_API_PATH:
        if (!content.replay) break;
        return serveReplayApi(content.replay, url);
    }
    return new Response('not found', { status: 404 });
  };
}

function isAddrInUse(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as Record<string, unknown>)['code'] === 'EADDRINUSE') {
    return true;
  }
  return (
    err instanceof Error &&
    (err.message.includes('EADDRINUSE') || err.message.includes('address already in use'))
  );
}

/**
 * Start the one local web server behind `tokenleak serve`, `--live-server`,
 * `--wrapped-live` and `replay --interactive`. It binds to loopback only and
 * tries the next port while the requested one is taken. It writes nothing
 * to stdout or stderr, so a full-screen TUI can host it.
 */
export async function startLiveSite(
  content: LiveSiteContent,
  options: LiveSiteOptions = {},
): Promise<LiveSite> {
  const state = { content: { ...content }, cache: {} as PageCache };
  const fetch = createHandler(state);
  const startPort = options.port ?? DEFAULT_LIVE_PORT;
  // Port 0 asks the OS for a free port, so there is nothing to retry.
  const attempts = startPort === 0 ? 1 : MAX_PORT_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const port = startPort + attempt;
    let server: ReturnType<typeof Bun.serve>;
    try {
      server = Bun.serve({ hostname: LOOPBACK_HOST, port, fetch });
    } catch (err: unknown) {
      if (isAddrInUse(err)) continue;
      throw err;
    }
    const actualPort = server.port ?? port;
    return {
      port: actualPort,
      url: (route) => `http://localhost:${actualPort}${route ? LIVE_ROUTES[route] : '/'}`,
      routes: () => availableRoutes(state.content),
      update: (next) => {
        state.content = { ...state.content, ...next };
        for (const route of Object.keys(next) as LiveRoute[]) delete state.cache[route];
      },
      stop: () => server.stop(true),
    };
  }

  throw new Error(
    `Could not find a free port after ${MAX_PORT_ATTEMPTS} attempts starting from ${startPort}`,
  );
}
