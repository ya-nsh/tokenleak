// Ad-hoc generator: synthesize a believable ReplayReport, render it via the
// production generateReplayLiveHtml, write the result to the landing repo.
//
// Run from the tokenleak repo root:
//   bun /tmp/replay-demo-gen.ts /Users/yansh/Desktop/work/tokenleak-landing/public/replay.html

import { writeFileSync } from 'node:fs';
import { generateReplayLiveHtml } from '@tokenleak/renderers';
import type { ReplayReport, UsageEvent, FlowBlock, TokenVelocityPoint } from '@tokenleak/core';

const out = process.argv[2];
if (!out) {
  console.error('usage: bun replay-demo-gen.ts <output.html>');
  process.exit(1);
}

// ── Synthetic day: 2026-04-22, 09:30 → 17:25 with 4 flow blocks ───────────────
const DATE = '2026-04-22';
// Emit timestamps with no timezone suffix so each viewer sees the synthetic
// hours rendered as local time (Date.parse treats undesignated ISO strings
// as local per ES 2015+). Keeps the demo consistent across timezones.
const T = (h: number, m: number, s = 0) =>
  `${DATE}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000`;

type EventSpec = {
  hour: number;
  minute: number;
  second?: number;
  model: string;
  inT: number;
  outT: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost: number;
};

function makeEvent(spec: EventSpec): UsageEvent {
  const cacheRead = spec.cacheRead ?? Math.round(spec.inT * 0.6);
  const cacheWrite = spec.cacheWrite ?? Math.round(spec.inT * 0.05);
  const total = spec.inT + spec.outT + cacheRead + cacheWrite;
  return {
    provider: spec.model.startsWith('gpt') ? 'codex' : 'claude-code',
    timestamp: T(spec.hour, spec.minute, spec.second),
    date: DATE,
    model: spec.model,
    inputTokens: spec.inT,
    outputTokens: spec.outT,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
    cost: spec.cost,
  };
}

// ---- Block 1: Deep Flow 09:30-10:50 — heavy refactor on Sonnet+GPT-5 mix ----
const block1Specs: EventSpec[] = [];
{
  let mm = 30;
  for (let i = 0; i < 38; i++) {
    const model = i % 5 === 0 ? 'gpt-5.4' : 'claude-sonnet-4';
    block1Specs.push({
      hour: 9 + Math.floor(mm / 60),
      minute: mm % 60,
      second: (i * 7) % 60,
      model,
      inT: 4_000 + Math.floor(Math.random() * 4_000),
      outT: 800 + Math.floor(Math.random() * 1_400),
      cost: 0.03 + Math.random() * 0.09,
    });
    mm += 1 + Math.floor(Math.random() * 2);
  }
}

// ---- Block 2: Quick Lookup 11:30-11:42 — Haiku-only, tiny prompts ----
const block2Specs: EventSpec[] = [];
{
  for (let i = 0; i < 14; i++) {
    block2Specs.push({
      hour: 11,
      minute: 30 + Math.floor(i * 0.8),
      second: (i * 11) % 60,
      model: 'claude-haiku-4',
      inT: 800 + Math.floor(Math.random() * 600),
      outT: 200 + Math.floor(Math.random() * 400),
      cost: 0.005 + Math.random() * 0.01,
    });
  }
}

// ---- Block 3: Deep Flow 14:00-15:35 — escalates to Opus partway ----
const block3Specs: EventSpec[] = [];
{
  let mm = 0;
  for (let i = 0; i < 52; i++) {
    const model = i < 18 ? 'claude-sonnet-4' : i < 40 ? 'claude-opus-4-7' : 'claude-sonnet-4';
    block3Specs.push({
      hour: 14 + Math.floor(mm / 60),
      minute: mm % 60,
      second: (i * 13) % 60,
      model,
      inT: 5_000 + Math.floor(Math.random() * 6_000),
      outT: 1_200 + Math.floor(Math.random() * 2_000),
      cost: model === 'claude-opus-4-7' ? 0.18 + Math.random() * 0.12 : 0.04 + Math.random() * 0.08,
    });
    mm += 1 + Math.floor(Math.random() * 2);
  }
}

// ---- Block 4: Moderate Session 17:00-17:25 — gpt-5.4 wrap-up ----
const block4Specs: EventSpec[] = [];
{
  for (let i = 0; i < 22; i++) {
    block4Specs.push({
      hour: 17,
      minute: Math.floor(i * 1.2),
      second: (i * 19) % 60,
      model: 'gpt-5.4',
      inT: 2_500 + Math.floor(Math.random() * 2_500),
      outT: 600 + Math.floor(Math.random() * 1_000),
      cost: 0.02 + Math.random() * 0.05,
    });
  }
}

const allSpecs = [...block1Specs, ...block2Specs, ...block3Specs, ...block4Specs];
const events: UsageEvent[] = allSpecs.map(makeEvent);
events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

function buildBlock(idx: number, label: FlowBlock['label'], blockEvents: UsageEvent[], cacheTrend: number[]): FlowBlock {
  const start = blockEvents[0].timestamp;
  const end = blockEvents[blockEvents.length - 1].timestamp;
  const totalTokens = blockEvents.reduce((s, e) => s + e.totalTokens, 0);
  const inputTokens = blockEvents.reduce((s, e) => s + e.inputTokens, 0);
  const outputTokens = blockEvents.reduce((s, e) => s + e.outputTokens, 0);
  const cacheReadTokens = blockEvents.reduce((s, e) => s + e.cacheReadTokens, 0);
  const cacheWriteTokens = blockEvents.reduce((s, e) => s + e.cacheWriteTokens, 0);
  const cost = blockEvents.reduce((s, e) => s + e.cost, 0);
  // Pick the model that contributed most tokens.
  const tally = new Map<string, number>();
  for (const e of blockEvents) tally.set(e.model, (tally.get(e.model) ?? 0) + e.totalTokens);
  const dominantModel = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0];
  // Count adjacent model switches.
  let modelSwitches = 0;
  for (let i = 1; i < blockEvents.length; i++) {
    if (blockEvents[i].model !== blockEvents[i - 1].model) modelSwitches++;
  }
  return {
    blockIndex: idx,
    label,
    start,
    end,
    durationMs: Date.parse(end) - Date.parse(start),
    eventCount: blockEvents.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    cost,
    dominantModel,
    events: blockEvents,
    modelSwitches,
    cacheHitRateTrend: cacheTrend,
  };
}

// Re-sort by timestamp into block-events
const block1Events = events.filter((e) => Date.parse(e.timestamp) <= Date.parse(T(10, 50)));
const block2Events = events.filter((e) => {
  const t = Date.parse(e.timestamp);
  return t >= Date.parse(T(11, 30)) && t <= Date.parse(T(11, 42));
});
const block3Events = events.filter((e) => {
  const t = Date.parse(e.timestamp);
  return t >= Date.parse(T(14, 0)) && t <= Date.parse(T(15, 35));
});
const block4Events = events.filter((e) => Date.parse(e.timestamp) >= Date.parse(T(17, 0)));

const flowBlocks: FlowBlock[] = [
  buildBlock(0, 'Deep Flow', block1Events, [0.32, 0.41, 0.55, 0.68, 0.74, 0.81]),
  buildBlock(1, 'Quick Lookup', block2Events, [0.22, 0.28]),
  buildBlock(2, 'Deep Flow', block3Events, [0.38, 0.49, 0.62, 0.71, 0.85, 0.92]),
  buildBlock(3, 'Moderate Session', block4Events, [0.51, 0.58, 0.66]),
];

// ── Velocity per minute over the day ──────────────────────────────────────────
// Bucket by truncating the local-style ISO string at the minute boundary so
// keys match the timezone interpretation of event timestamps above.
const velocityMap = new Map<string, number>();
for (const e of events) {
  const key = `${e.timestamp.slice(0, 16)}:00.000`;
  velocityMap.set(key, (velocityMap.get(key) ?? 0) + e.totalTokens);
}
const tokenVelocity: TokenVelocityPoint[] = Array.from(velocityMap.entries())
  .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
  .map(([minute, tpm]) => ({ minute, tokensPerMinute: tpm }));

const peak = tokenVelocity.reduce((acc, v) => (v.tokensPerMinute > acc.tokensPerMinute ? v : acc), tokenVelocity[0]);
const flowTimeMs = flowBlocks.reduce((s, b) => s + b.durationMs, 0);
const dayStart = Date.parse(events[0].timestamp);
const dayEnd = Date.parse(events[events.length - 1].timestamp);
const dayDurationMs = dayEnd - dayStart;
const thinkTimeMs = Math.max(0, dayDurationMs - flowTimeMs);

const report: ReplayReport = {
  date: DATE,
  events,
  flowBlocks,
  tokenVelocity,
  summary: {
    totalSessions: 3,
    totalEvents: events.length,
    flowTimeMs,
    thinkTimeMs,
    flowThinkRatio: flowTimeMs / Math.max(1, dayDurationMs),
    peakMinute: peak,
  },
};

const totalCost = events.reduce((s, e) => s + e.cost, 0);
const totalTokens = events.reduce((s, e) => s + e.totalTokens, 0);
console.error(`generated demo: ${events.length} events, ${flowBlocks.length} blocks, $${totalCost.toFixed(2)}, ${(totalTokens/1e6).toFixed(2)}M tokens`);

const html = generateReplayLiveHtml(report);
writeFileSync(out, html, 'utf-8');
console.error(`wrote ${html.length} chars to ${out}`);
