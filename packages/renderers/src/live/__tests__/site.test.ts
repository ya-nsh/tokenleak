import { afterEach, describe, expect, it } from 'bun:test';
import { buildReplayReport } from '@tokenleak/core';
import { createOutput, createRenderOptions } from '../../__test-fixtures__';
import { LIVE_ROUTES, generateLiveIndexHtml, startLiveSite } from '../site';
import type { LiveSite } from '../site';

describe('generateLiveIndexHtml', () => {
  it('links every route it is given, in order', () => {
    const html = generateLiveIndexHtml(['dashboard', 'replay']);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/replay"');
    expect(html).not.toContain('href="/wrapped"');
    expect(html.indexOf('/dashboard')).toBeLessThan(html.indexOf('/replay'));
  });

  it('says so when no page has data', () => {
    expect(generateLiveIndexHtml([])).toContain('No pages have data yet.');
  });
});

describe('startLiveSite', () => {
  const sites: LiveSite[] = [];

  afterEach(() => {
    while (sites.length > 0) sites.pop()?.stop();
  });

  async function start(...args: Parameters<typeof startLiveSite>): Promise<LiveSite> {
    const site = await startLiveSite(...args);
    sites.push(site);
    return site;
  }

  it('serves an index linking only the pages that have data', async () => {
    const site = await start({ wrapped: createOutput() }, { port: 0 });
    const html = await (await fetch(site.url())).text();
    expect(html).toContain('href="/wrapped"');
    expect(html).not.toContain('href="/dashboard"');
    expect(site.routes()).toEqual(['wrapped']);
  });

  it('returns 404 for a page without data and for unknown paths', async () => {
    const site = await start({ wrapped: createOutput() }, { port: 0 });
    expect((await fetch(site.url('dashboard'))).status).toBe(404);
    expect((await fetch(site.url('replay'))).status).toBe(404);
    expect((await fetch(`${site.url()}api/replay?date=2026-03-12`)).status).toBe(404);
    expect((await fetch(`${site.url()}nope`)).status).toBe(404);
  });

  it('builds page URLs from the bound port', async () => {
    const site = await start({}, { port: 0 });
    expect(site.port).toBeGreaterThan(0);
    expect(site.url()).toBe(`http://localhost:${site.port}/`);
    for (const [route, path] of Object.entries(LIVE_ROUTES)) {
      expect(site.url(route as keyof typeof LIVE_ROUTES)).toBe(
        `http://localhost:${site.port}${path}`,
      );
    }
  });

  it('serves every page from one port', async () => {
    const site = await start(
      {
        dashboard: { output: createOutput(), options: createRenderOptions() },
        wrapped: createOutput(),
        replay: buildReplayReport([], '2026-03-12'),
      },
      { port: 0 },
    );
    expect(await (await fetch(site.url('dashboard'))).text()).toContain('heatmap-cell');
    expect(await (await fetch(site.url('wrapped'))).text()).toContain('id="s0"');
    expect(await (await fetch(site.url('replay'))).text()).toContain('window.__REPLAY__');
  });

  it('adds a page on update and rebuilds a replaced one', async () => {
    const site = await start(
      { wrapped: createOutput({ dateRange: { since: '2026-01-01', until: '2026-01-31' } }) },
      { port: 0 },
    );
    expect(await (await fetch(site.url('wrapped'))).text()).toContain('2026');
    expect((await fetch(site.url('replay'))).status).toBe(404);

    site.update({ replay: buildReplayReport([], '2026-03-12') });
    expect((await fetch(site.url('replay'))).status).toBe(200);
    expect(site.routes()).toEqual(['wrapped', 'replay']);

    site.update({ replay: buildReplayReport([], '2026-04-01') });
    expect(await (await fetch(site.url('replay'))).text()).toContain('2026-04-01');
  });

  it('answers the replay API for a single-day report', async () => {
    const site = await start({ replay: buildReplayReport([], '2026-03-12') }, { port: 0 });
    const hit = await fetch(`${site.url()}api/replay?date=2026-03-12`);
    expect(hit.status).toBe(200);
    expect(((await hit.json()) as { date: string }).date).toBe('2026-03-12');
    expect((await fetch(`${site.url()}api/replay?date=2026-03-13`)).status).toBe(404);
    expect((await fetch(`${site.url()}api/replay?date=bad`)).status).toBe(400);
  });

  it('tries the next port while the requested one is taken', async () => {
    const seed = 19_891;
    const first = await start({}, { port: seed });
    const second = await start({}, { port: seed });
    expect(first.port).toBe(seed);
    expect(second.port).toBeGreaterThan(seed);
  });

  it('does not write to stdout or stderr, so a TUI can host it', async () => {
    const writes: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => (
      writes.push(chunk),
      true
    )) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => (
      writes.push(chunk),
      true
    )) as typeof process.stderr.write;
    try {
      await start({ wrapped: createOutput() }, { port: 0 });
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }
    expect(writes).toEqual([]);
  });
});
