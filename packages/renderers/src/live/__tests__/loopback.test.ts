import { expect, test } from 'bun:test';
import { networkInterfaces } from 'node:os';
import { buildReplayReport } from '@tokenleak/core';
import { createOutput, createRenderOptions } from '../../__test-fixtures__';
import { LIVE_ROUTES, startLiveSite } from '../site';

const address = Object.values(networkInterfaces()).flat().find(
  (entry) => entry?.family === 'IPv4' && !entry.internal,
)?.address;

const paths = ['/', ...Object.values(LIVE_ROUTES)];

test.each(paths)('live page %s remains reachable only on loopback', async (path) => {
  const server = await startLiveSite(
    {
      dashboard: { output: createOutput(), options: createRenderOptions() },
      wrapped: createOutput(),
      replay: buildReplayReport([], '2026-03-12'),
    },
    { port: 0 },
  );
  try {
    expect((await fetch(`http://127.0.0.1:${server.port}${path}`)).status).toBe(200);
    if (address) {
      await expect(fetch(`http://${address}:${server.port}${path}`, {
        signal: AbortSignal.timeout(1000),
      })).rejects.toThrow();
    }
  } finally {
    server.stop();
  }
});
