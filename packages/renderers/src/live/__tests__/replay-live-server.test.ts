import { describe, expect, it, afterEach } from 'bun:test';
import type { ReplayReport, UsageEvent, FlowBlock } from '@tokenleak/core';
import { startReplayLiveServer } from '../replay-live-server';
import { generateReplayLiveHtml } from '../replay-live-template';

function makeEvent(overrides: Partial<UsageEvent> & { timestamp: string }): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: overrides.timestamp,
    date: overrides.timestamp.slice(0, 10),
    model: overrides.model ?? 'claude-sonnet-4',
    inputTokens: overrides.inputTokens ?? 1000,
    outputTokens: overrides.outputTokens ?? 200,
    cacheReadTokens: overrides.cacheReadTokens ?? 500,
    cacheWriteTokens: overrides.cacheWriteTokens ?? 100,
    totalTokens: overrides.totalTokens ?? 1800,
    cost: overrides.cost ?? 0.012,
  };
}

function makeBlock(overrides: Partial<FlowBlock> & { blockIndex: number; start: string; end: string; events: UsageEvent[] }): FlowBlock {
  const tokens = overrides.events.reduce((sum, e) => sum + e.totalTokens, 0);
  const cost = overrides.events.reduce((sum, e) => sum + e.cost, 0);
  return {
    blockIndex: overrides.blockIndex,
    label: overrides.label ?? 'Deep Flow',
    start: overrides.start,
    end: overrides.end,
    durationMs: overrides.durationMs ?? Date.parse(overrides.end) - Date.parse(overrides.start),
    eventCount: overrides.events.length,
    inputTokens: overrides.events.reduce((s, e) => s + e.inputTokens, 0),
    outputTokens: overrides.events.reduce((s, e) => s + e.outputTokens, 0),
    cacheReadTokens: overrides.events.reduce((s, e) => s + e.cacheReadTokens, 0),
    cacheWriteTokens: overrides.events.reduce((s, e) => s + e.cacheWriteTokens, 0),
    totalTokens: tokens,
    cost: cost,
    dominantModel: overrides.dominantModel ?? 'claude-sonnet-4',
    events: overrides.events,
    modelSwitches: overrides.modelSwitches ?? 0,
    cacheHitRateTrend: overrides.cacheHitRateTrend ?? [0.4, 0.55],
  };
}

function makeReport(): ReplayReport {
  const events: UsageEvent[] = [
    makeEvent({ timestamp: '2026-04-26T09:00:00.000Z', model: 'claude-sonnet-4' }),
    makeEvent({ timestamp: '2026-04-26T09:01:00.000Z', model: 'claude-sonnet-4' }),
    makeEvent({ timestamp: '2026-04-26T09:30:00.000Z', model: 'claude-haiku-4', cost: 0.002 }),
    makeEvent({ timestamp: '2026-04-26T10:15:00.000Z', model: 'claude-sonnet-4' }),
  ];
  const block1Events = events.slice(0, 2);
  const block2Events = events.slice(2, 3);
  const block3Events = events.slice(3, 4);
  return {
    date: '2026-04-26',
    events,
    flowBlocks: [
      makeBlock({ blockIndex: 0, start: '2026-04-26T09:00:00.000Z', end: '2026-04-26T09:01:00.000Z', events: block1Events, label: 'Deep Flow' }),
      makeBlock({ blockIndex: 1, start: '2026-04-26T09:30:00.000Z', end: '2026-04-26T09:30:00.000Z', events: block2Events, label: 'Quick Lookup', dominantModel: 'claude-haiku-4' }),
      makeBlock({ blockIndex: 2, start: '2026-04-26T10:15:00.000Z', end: '2026-04-26T10:15:00.000Z', events: block3Events, label: 'Moderate Session' }),
    ],
    tokenVelocity: [
      { minute: '2026-04-26T09:00:00.000Z', tokensPerMinute: 1800 },
      { minute: '2026-04-26T09:01:00.000Z', tokensPerMinute: 1800 },
      { minute: '2026-04-26T09:30:00.000Z', tokensPerMinute: 1800 },
      { minute: '2026-04-26T10:15:00.000Z', tokensPerMinute: 1800 },
    ],
    summary: {
      totalSessions: 1,
      totalEvents: 4,
      flowTimeMs: 60_000,
      thinkTimeMs: 4_440_000,
      flowThinkRatio: 0.013,
      peakMinute: { minute: '2026-04-26T09:00:00.000Z', tokensPerMinute: 1800 },
    },
  };
}

describe('generateReplayLiveHtml', () => {
  it('returns a valid HTML document', () => {
    const html = generateReplayLiveHtml(makeReport());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('embeds the replay report as window.__REPLAY__', () => {
    const html = generateReplayLiveHtml(makeReport());
    expect(html).toContain('window.__REPLAY__');
    const match = html.match(/window\.__REPLAY__ = (\{[\s\S]*?\});/);
    expect(match).not.toBeNull();
    expect(() => JSON.parse(match![1])).not.toThrow();
    const parsed = JSON.parse(match![1]) as ReplayReport;
    expect(parsed.date).toBe('2026-04-26');
    expect(parsed.events).toHaveLength(4);
  });

  it('renders timeline + transport + grid scaffolding', () => {
    const html = generateReplayLiveHtml(makeReport());
    expect(html).toContain('id="timeline"');
    expect(html).toContain('id="btnPlay"');
    expect(html).toContain('id="odoVal"');
    expect(html).toContain('id="eventList"');
    expect(html).toContain('id="mixSvg"');
    expect(html).toContain('id="blockCard"');
  });

  it('renders the prompt-detail card so users can see what was asked', () => {
    const html = generateReplayLiveHtml(makeReport());
    expect(html).toContain('id="promptCard"');
    expect(html).toContain('id="promptMeta"');
    expect(html).toContain('id="promptBody"');
    expect(html).toContain('// prompt sent to model');
  });

  it('embeds prompt text from events into window.__REPLAY__', () => {
    const baseEvent = makeEvent({
      timestamp: '2026-04-26T09:00:00.000Z',
      model: 'claude-sonnet-4',
    });
    const events: UsageEvent[] = [
      { ...baseEvent, prompt: 'refactor the date-loader to support streaming inputs' },
    ];
    const report: ReplayReport = {
      date: '2026-04-26',
      events,
      flowBlocks: [makeBlock({ blockIndex: 0, start: events[0].timestamp, end: events[0].timestamp, events })],
      tokenVelocity: [],
      summary: {
        totalSessions: 1,
        totalEvents: 1,
        flowTimeMs: 0,
        thinkTimeMs: 0,
        flowThinkRatio: 0,
        peakMinute: null,
      },
    };
    const html = generateReplayLiveHtml(report);
    expect(html).toContain('refactor the date-loader to support streaming inputs');
  });

  it('shows the date in the page title and header', () => {
    const html = generateReplayLiveHtml(makeReport());
    expect(html).toContain('<title>tokenleak replay · 2026-04-26</title>');
    expect(html).toContain('April 26, 2026');
  });

  it('renders the empty-state body when there are no events', () => {
    const empty: ReplayReport = {
      date: '2026-04-26',
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
    const html = generateReplayLiveHtml(empty);
    expect(html).toContain('nothing happened on 2026-04-26');
    expect(html).not.toContain('id="timeline"');
  });

  it('emits the activeBlockIndex padding logic so playback does not skip zero-duration blocks', () => {
    const html = generateReplayLiveHtml(makeReport());
    // Tripwire: if someone reverts the padding around active-block hit-testing,
    // playback at high speeds will visibly skip past single-event blocks.
    expect(html).toContain('ACTIVE_BLOCK_MIN_PAD_MS');
    expect(html).toContain('padBefore');
    expect(html).toContain('padAfter');
  });

  it('escapes the embedded JSON so a closing </script> in data does not break the page', () => {
    const r = makeReport();
    r.events[0].model = 'evil</script><script>alert(1)</script>';
    const html = generateReplayLiveHtml(r);
    // The literal closing tag must NOT appear inside the JSON payload.
    const scriptIdx = html.indexOf('window.__REPLAY__');
    const slice = html.slice(scriptIdx, scriptIdx + 4000);
    expect(slice).not.toContain('</script><script>alert(1)');
    expect(slice).toContain('<\\/script>');
  });
});

describe('startReplayLiveServer', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const stop = cleanups.pop();
      try { stop?.(); } catch { /* noop */ }
    }
  });

  it('starts on port 0 (any free port) and returns 200', async () => {
    const { port, stop } = await startReplayLiveServer(makeReport(), { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
  });

  it('responds with content-type text/html', async () => {
    const { port, stop } = await startReplayLiveServer(makeReport(), { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
  });

  it('serves HTML containing the embedded replay payload', async () => {
    const { port, stop } = await startReplayLiveServer(makeReport(), { port: 0 });
    cleanups.push(stop);
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    expect(html).toContain('window.__REPLAY__');
    expect(html).toContain('id="timeline"');
  });

  it('shuts down cleanly', async () => {
    const { port, stop } = await startReplayLiveServer(makeReport(), { port: 0 });
    expect((await fetch(`http://localhost:${port}/`)).status).toBe(200);
    stop();
    let connectionRefused = false;
    try {
      await fetch(`http://localhost:${port}/`);
    } catch {
      connectionRefused = true;
    }
    expect(connectionRefused).toBe(true);
  });

  it('falls back to the next port when the requested one is taken', async () => {
    const seed = 19_889;
    const a = await startReplayLiveServer(makeReport(), { port: seed });
    cleanups.push(a.stop);
    const b = await startReplayLiveServer(makeReport(), { port: seed });
    cleanups.push(b.stop);
    expect(a.port).toBe(seed);
    expect(b.port).toBeGreaterThan(a.port);
  });
});

describe('startReplayLiveServer (multi-day mode)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const stop = cleanups.pop();
      try { stop?.(); } catch { /* noop */ }
    }
  });

  function makeProvider() {
    const initial = makeReport();
    const otherDate = '2026-04-21';
    const otherReport: ReplayReport = {
      ...initial,
      date: otherDate,
      events: initial.events.map((e) => ({ ...e, date: otherDate, timestamp: e.timestamp.replace('2026-04-26', otherDate) })),
    };
    return {
      heatmap: [
        { date: '2026-04-21', tokens: 7_200, cost: 0.04, events: 4 },
        { date: '2026-04-26', tokens: 7_200, cost: 0.04, events: 4 },
      ],
      initialDate: '2026-04-26',
      initialReport: initial,
      otherReport,
    };
  }

  it('renders the heatmap on GET /', async () => {
    const p = makeProvider();
    const { port, stop } = await startReplayLiveServer({
      heatmap: p.heatmap,
      initialDate: p.initialDate,
      initialReport: p.initialReport,
      getReport: async (d) => (d === p.otherReport.date ? p.otherReport : null),
    }, { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="heatmap-grid"');
    expect(html).toContain('hm-cell--active');
    expect(html).toContain('href="/?date=2026-04-21"');
  });

  it('serves a different day for /?date=YYYY-MM-DD via getReport', async () => {
    const p = makeProvider();
    let lookedUp: string | null = null;
    const { port, stop } = await startReplayLiveServer({
      heatmap: p.heatmap,
      initialDate: p.initialDate,
      initialReport: p.initialReport,
      getReport: async (d) => {
        lookedUp = d;
        return d === p.otherReport.date ? p.otherReport : null;
      },
    }, { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/?date=2026-04-21`);
    expect(res.status).toBe(200);
    expect(lookedUp).toBe('2026-04-21');
    const html = await res.text();
    expect(html).toContain('window.__REPLAY__');
    expect(html).toContain('"date":"2026-04-21"');
  });

  it('falls back to an empty report (not 404) for an unknown day on GET /', async () => {
    const p = makeProvider();
    const { port, stop } = await startReplayLiveServer({
      heatmap: p.heatmap,
      initialDate: p.initialDate,
      initialReport: p.initialReport,
      getReport: async () => null,
    }, { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/?date=2025-01-01`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('nothing happened on 2025-01-01');
  });

  it('GET /api/replay?date=X returns 200 + JSON for a known day', async () => {
    const p = makeProvider();
    const { port, stop } = await startReplayLiveServer({
      heatmap: p.heatmap,
      initialDate: p.initialDate,
      initialReport: p.initialReport,
      getReport: async (d) => (d === p.otherReport.date ? p.otherReport : null),
    }, { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/api/replay?date=2026-04-21`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = await res.json() as ReplayReport;
    expect(body.date).toBe('2026-04-21');
  });

  it('GET /api/replay?date=invalid returns 400', async () => {
    const p = makeProvider();
    const { port, stop } = await startReplayLiveServer({
      heatmap: p.heatmap,
      initialDate: p.initialDate,
      initialReport: p.initialReport,
      getReport: async () => null,
    }, { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/api/replay?date=foo`);
    expect(res.status).toBe(400);
  });

  it('GET /api/replay?date=missing returns 404', async () => {
    const p = makeProvider();
    const { port, stop } = await startReplayLiveServer({
      heatmap: p.heatmap,
      initialDate: p.initialDate,
      initialReport: p.initialReport,
      getReport: async () => null,
    }, { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/api/replay?date=2024-12-31`);
    expect(res.status).toBe(404);
  });

  it('single-day mode (passing a ReplayReport) does NOT render the heatmap', async () => {
    const { port, stop } = await startReplayLiveServer(makeReport(), { port: 0 });
    cleanups.push(stop);
    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();
    // Structural element: only emitted when the heatmap section is rendered.
    // (The CSS class names live in the inlined stylesheet either way, so we
    // can't grep on `hm-cell--active` to detect single- vs multi-day mode.)
    expect(html).not.toContain('<section class="section heatmap-section"');
    expect(html).not.toContain('href="/?date=');
  });
});
