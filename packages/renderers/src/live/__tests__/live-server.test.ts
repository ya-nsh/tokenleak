import { describe, expect, it, afterEach } from 'bun:test';
import { startLiveServer } from '../live-server';
import {
  createOutput,
  createRenderOptions,
  createProvider,
} from '../../__test-fixtures__';

describe('startLiveServer', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const stop of cleanups) {
      try { stop(); } catch { /* ignore */ }
    }
    cleanups.length = 0;
  });

  it('starts and responds with 200 on /', async () => {
    const { port, stop } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 0 },
    );
    cleanups.push(stop);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
  });

  it('responds with content-type text/html', async () => {
    const { port, stop } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 0 },
    );
    cleanups.push(stop);

    const res = await fetch(`http://localhost:${port}/`);
    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toContain('text/html');
  });

  it('HTML contains the terminal card structure', async () => {
    const { port, stop } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 0 },
    );
    cleanups.push(stop);

    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();

    // Traffic lights
    expect(html).toContain('dot-red');
    expect(html).toContain('dot-yellow');
    expect(html).toContain('dot-green');

    // Heatmap
    expect(html).toContain('heatmap-cell');

    // Stats
    expect(html).toContain('CURRENT STREAK');
    expect(html).toContain('TOTAL TOKENS');
  });

  it('shuts down cleanly', async () => {
    const { port, stop } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 0 },
    );

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
    const { port: port1, stop: stop1 } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 19876 },
    );
    cleanups.push(stop1);

    const { port: port2, stop: stop2 } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 19876 },
    );
    cleanups.push(stop2);

    expect(port1).toBe(19876);
    expect(port2).not.toBe(port1);
    expect(port2).toBeGreaterThan(port1);

    const res1 = await fetch(`http://localhost:${port1}/`);
    const res2 = await fetch(`http://localhost:${port2}/`);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('HTML contains per-provider sections for multiple providers', async () => {
    const multiOutput = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
      ],
    });
    const { port, stop } = await startLiveServer(
      multiOutput,
      { ...createRenderOptions(), port: 0 },
    );
    cleanups.push(stop);

    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();

    expect(html).toContain('Claude Code');
    expect(html).toContain('Codex');
    expect(html).toContain('provider-section');
    expect(html).toContain('provider-dot');
    expect(html).toContain('OVERALL');
  });
});
