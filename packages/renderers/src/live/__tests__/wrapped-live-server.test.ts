import { describe, expect, it, afterEach } from 'bun:test';
import { startWrappedLiveServer } from '../wrapped-live-server';
import { generateWrappedLiveHtml } from '../wrapped-live-template';
import {
  createOutput,
  createProvider,
  createMoreStats,
  createPopulatedStats,
  createZeroedStats,
} from '../../__test-fixtures__';

describe('generateWrappedLiveHtml', () => {
  it('returns a valid HTML document', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('contains all 12 slides', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    for (let i = 0; i < 12; i++) {
      expect(html).toContain(`id="s${i}"`);
    }
  });

  it('includes the Google Fonts link', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('Bricolage+Grotesque');
    expect(html).toContain('Space+Grotesk');
    expect(html).toContain('Space+Mono');
  });

  it('includes the TokenLeak stamp', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('stamp-name');
    expect(html).toContain('TokenLeak');
  });

  it('includes navigation buttons', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('btnPrev');
    expect(html).toContain('btnNext');
    expect(html).toContain('counter');
  });

  it('renders real stats from aggregated data', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ totalTokens: 5000000, totalCost: 150 }),
      more: createMoreStats(),
    });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('5.0M');
    expect(html).toContain('150');
  });

  it('handles zeroed stats gracefully', () => {
    const output = createOutput({
      aggregated: createZeroedStats(),
      more: null,
    });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="s0"');
    expect(html).toContain('id="s11"');
  });

  it('includes provider names in provider mix slide', () => {
    const output = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
      ],
      more: createMoreStats(),
    });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('Claude Code');
    expect(html).toContain('Codex');
  });

  it('includes model names from top models', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('claude-3-opus');
    expect(html).toContain('claude-3-sonnet');
  });

  it('includes the date range from output', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('Jan');
    expect(html).toContain('Mar');
    expect(html).toContain('2026');
  });

  it('renders peak day data when present', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({
        peakDay: { date: '2026-03-01', tokens: 87432 },
        averageDailyTokens: 14000,
      }),
      more: createMoreStats(),
    });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('87.4K');
    expect(html).toContain('March 1, 2026');
  });

  it('renders badges section', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('badge');
    expect(html).toContain('Streak Master');
  });

  it('contains the slide transition JS', () => {
    const output = createOutput({ more: createMoreStats() });
    const html = generateWrappedLiveHtml(output);

    expect(html).toContain('function goTo');
    expect(html).toContain('ArrowRight');
    expect(html).toContain('touchstart');
  });
});

describe('startWrappedLiveServer', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const stop of cleanups) {
      try { stop(); } catch { /* ignore */ }
    }
    cleanups.length = 0;
  });

  it('starts and responds with 200 on /', async () => {
    const output = createOutput({ more: createMoreStats() });
    const { port, stop } = await startWrappedLiveServer(output, { port: 0 });
    cleanups.push(stop);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
  });

  it('responds with content-type text/html', async () => {
    const output = createOutput({ more: createMoreStats() });
    const { port, stop } = await startWrappedLiveServer(output, { port: 0 });
    cleanups.push(stop);

    const res = await fetch(`http://localhost:${port}/`);
    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toContain('text/html');
  });

  it('HTML contains slide structure', async () => {
    const output = createOutput({ more: createMoreStats() });
    const { port, stop } = await startWrappedLiveServer(output, { port: 0 });
    cleanups.push(stop);

    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();

    expect(html).toContain('id="s0"');
    expect(html).toContain('id="s11"');
    expect(html).toContain('Bricolage');
  });

  it('shuts down cleanly', async () => {
    const output = createOutput({ more: createMoreStats() });
    const { port, stop } = await startWrappedLiveServer(output, { port: 0 });

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);

    stop();

    try {
      await fetch(`http://localhost:${port}/`);
    } catch {
      // Expected: connection refused
    }
  });

  it('port fallback works when default port is taken', async () => {
    const output = createOutput({ more: createMoreStats() });
    const { port: port1, stop: stop1 } = await startWrappedLiveServer(output, { port: 19877 });
    cleanups.push(stop1);

    const { port: port2, stop: stop2 } = await startWrappedLiveServer(output, { port: 19877 });
    cleanups.push(stop2);

    expect(port1).toBe(19877);
    expect(port2).not.toBe(port1);
    expect(port2).toBeGreaterThan(port1);
  });
});
