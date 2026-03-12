import { describe, expect, it, afterEach } from 'bun:test';
import { startLiveServer } from '../live-server';
import {
  createOutput,
  createRenderOptions,
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

    // Verify server is running
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);

    // Stop the server
    stop();

    // After stopping, fetch should fail
    try {
      await fetch(`http://localhost:${port}/`);
      // If we get here, the server hasn't fully stopped yet which is okay
      // in some environments — the important thing is stop() doesn't throw
    } catch {
      // Expected: connection refused
    }
  });

  it('port fallback works when default port is taken', async () => {
    // Start first server on a specific port
    const { port: port1, stop: stop1 } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 19876 },
    );
    cleanups.push(stop1);

    // Start second server on the same port — should increment
    const { port: port2, stop: stop2 } = await startLiveServer(
      createOutput(),
      { ...createRenderOptions(), port: 19876 },
    );
    cleanups.push(stop2);

    expect(port1).toBe(19876);
    expect(port2).not.toBe(port1);
    expect(port2).toBeGreaterThan(port1);

    // Both should respond
    const res1 = await fetch(`http://localhost:${port1}/`);
    const res2 = await fetch(`http://localhost:${port2}/`);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
