/** Local audit: TOKENLEAK_USAGE_CACHE=0 bun scripts/perf-audit.ts [runs] */
import { createHash } from 'node:crypto';
import * as registry from '../packages/registry/src/index';
import { loadAllData } from '../packages/tui/src/lib/data';
import { buildMoreStats } from '../packages/core/src/index';

const runs = Number(process.argv[2] ?? 3);
if (!Number.isInteger(runs) || runs < 1) throw new Error('runs must be a positive integer');
let timings: Record<string, number> = {};
for (const [name, value] of Object.entries(registry)) {
  if (!name.endsWith('Provider') || typeof value !== 'function' || !('load' in value.prototype))
    continue;
  const original = value.prototype.load;
  value.prototype.load = async function (...args: unknown[]) {
    const start = performance.now();
    try {
      return await original.apply(this, args);
    } finally {
      timings[this.name] = Math.round(performance.now() - start);
    }
  };
}
for (let run = 1; run <= runs; run++) {
  timings = {};
  const start = performance.now();
  const data = await loadAllData({ attemptCursorSync: false });
  const loadMs = performance.now() - start;
  const reportStart = performance.now();
  buildMoreStats(data.providers, data.dateRange);
  const moreStatsMs = performance.now() - reportStart;
  // Hash outputs, never print prompts, project paths or usage details.
  const hashes = Object.fromEntries(
    data.providers.map((p) => [
      p.provider,
      createHash('sha256').update(JSON.stringify(p)).digest('hex'),
    ]),
  );
  process.stdout.write(
    JSON.stringify({
      run,
      cache: process.env['TOKENLEAK_USAGE_CACHE'] !== '0',
      loadMs: Math.round(loadMs),
      moreStatsMs: Math.round(moreStatsMs),
      providers: timings,
      events: data.providers.reduce((sum, p) => sum + (p.events?.length ?? 0), 0),
      hashes,
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    }) + '\n',
  );
}
