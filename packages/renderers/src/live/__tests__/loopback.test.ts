import { expect, test } from 'bun:test';
import { networkInterfaces } from 'node:os';
import { buildReplayReport } from '@tokenleak/core';
import { createOutput, createRenderOptions } from '../../__test-fixtures__';
import { startLiveServer } from '../live-server';
import { startReplayLiveServer } from '../replay-live-server';
import { startWrappedLiveServer } from '../wrapped-live-server';

const address = Object.values(networkInterfaces()).flat().find(
  (entry) => entry?.family === 'IPv4' && !entry.internal,
)?.address;

const starters = [
  () => startLiveServer(createOutput(), { ...createRenderOptions(), port: 0 }),
  () => startReplayLiveServer(buildReplayReport([], '2026-03-12'), { port: 0, silent: true }),
  () => startWrappedLiveServer(createOutput(), { port: 0 }),
];

test.each(starters)('live reports remain reachable only on loopback', async (start) => {
  const server = await start();
  try {
    expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(200);
    if (address) {
      await expect(fetch(`http://${address}:${server.port}/`, {
        signal: AbortSignal.timeout(1000),
      })).rejects.toThrow();
    }
  } finally {
    server.stop();
  }
});
