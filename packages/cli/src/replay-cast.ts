import type { ReplayReport, UsageEvent } from '@tokenleak/core';

/**
 * Asciinema cast (v2) generator for replays. Renders the replay as a series
 * of plain-text frames timed to match the requested speed; opening the file
 * in `asciinema play` produces a cinematic playback of the day.
 *
 * Output is the canonical asciinema-rec format:
 *   line 1: a single JSON header ({"version": 2, ...})
 *   line N: a JSON array per frame: [t_seconds, "o", "<terminal data>"]
 *
 * One frame per real event is emitted (rather than one per fixed wall-time
 * tick) so that bursty days produce dense scrubs and idle stretches yield
 * long natural pauses — exactly matching the lived experience of the day.
 */

export const CAST_DEFAULT_WIDTH = 100;
export const CAST_DEFAULT_HEIGHT = 32;
export const CAST_DEFAULT_SPEED = 240;

const HEATMAP_BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const HEATMAP_SLOTS = 48;

export interface BuildReplayCastOptions {
  speed?: number;
  width?: number;
  height?: number;
  /** Override clock for header timestamp (used by tests). */
  nowSeconds?: number;
}

export interface ReplayCastFrame {
  /** Offset in seconds from cast start. */
  t: number;
  /** Output bytes (terminal data). */
  data: string;
}

export function buildReplayCast(report: ReplayReport, options: BuildReplayCastOptions = {}): string {
  const speed = options.speed ?? CAST_DEFAULT_SPEED;
  const width = options.width ?? CAST_DEFAULT_WIDTH;
  const height = options.height ?? CAST_DEFAULT_HEIGHT;
  const nowSeconds = Math.floor(options.nowSeconds ?? Date.now() / 1000);

  const header = {
    version: 2,
    width,
    height,
    timestamp: nowSeconds,
    title: `tokenleak replay ${report.date}`,
    env: { TERM: 'xterm-256color', SHELL: '/bin/bash' },
  };

  const lines: string[] = [JSON.stringify(header)];

  const frames = computeReplayCastFrames(report, { speed, width });
  for (const frame of frames) {
    lines.push(JSON.stringify([Number(frame.t.toFixed(3)), 'o', frame.data]));
  }
  return lines.join('\n') + '\n';
}

export function computeReplayCastFrames(
  report: ReplayReport,
  opts: { speed: number; width: number },
): ReplayCastFrame[] {
  const events = report.events;
  if (events.length === 0) {
    return [
      {
        t: 0,
        data: '\x1b[2J\x1b[H' + renderEmptyFrame(report, opts.width),
      },
    ];
  }

  const dayStart = Date.parse(events[0].timestamp);
  const totalCost = events.reduce((s, e) => s + e.cost, 0);
  const totalTokens = events.reduce((s, e) => s + e.totalTokens, 0);

  const frames: ReplayCastFrame[] = [];
  let cumCost = 0;
  let cumTokens = 0;
  let cumInput = 0;
  let cumCacheR = 0;
  const modelMix = new Map<string, number>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    cumCost += e.cost;
    cumTokens += e.totalTokens;
    cumInput += e.inputTokens;
    cumCacheR += e.cacheReadTokens;
    modelMix.set(e.model, (modelMix.get(e.model) ?? 0) + e.totalTokens);

    const t = (Date.parse(e.timestamp) - dayStart) / 1000 / opts.speed;
    const frame = renderPlaybackFrame(report, {
      cursorIndex: i,
      totalCost,
      totalTokens,
      cumCost,
      cumTokens,
      cumInput,
      cumCacheR,
      modelMix,
      width: opts.width,
      speed: opts.speed,
    });
    frames.push({ t, data: '\x1b[2J\x1b[H' + frame });
  }
  return frames;
}

interface FrameContext {
  cursorIndex: number;
  totalCost: number;
  totalTokens: number;
  cumCost: number;
  cumTokens: number;
  cumInput: number;
  cumCacheR: number;
  modelMix: Map<string, number>;
  width: number;
  speed: number;
}

function renderPlaybackFrame(report: ReplayReport, ctx: FrameContext): string {
  const cursorEvent = report.events[ctx.cursorIndex];
  const lines: string[] = [];

  const title = `tokenleak replay · ${report.date}`;
  const right = `[event ${ctx.cursorIndex + 1}/${report.events.length} · ${ctx.speed}×]`;
  lines.push(padBetween(title, right, ctx.width));
  lines.push('');

  // Stats block
  const cacheRate = ctx.cumInput + ctx.cumCacheR > 0
    ? ctx.cumCacheR / (ctx.cumInput + ctx.cumCacheR)
    : 0;
  const costLine = `cost: ${formatCost(ctx.cumCost)} / ${formatCost(ctx.totalCost)}    tokens: ${formatTokens(ctx.cumTokens)} / ${formatTokens(ctx.totalTokens)}    cache ${formatPercent(cacheRate)}`;
  lines.push(costLine);
  const cacheRateOnEvent = cursorEvent.inputTokens + cursorEvent.cacheReadTokens > 0
    ? cursorEvent.cacheReadTokens / (cursorEvent.inputTokens + cursorEvent.cacheReadTokens)
    : 0;
  const eventLine = `clock: ${formatTimeSeconds(cursorEvent.timestamp)}    event: ${cursorEvent.model} · ${formatTokens(cursorEvent.totalTokens)} tok · cache ${formatPercent(cacheRateOnEvent)} · ${formatCost(cursorEvent.cost)}`;
  lines.push(eventLine);
  lines.push('');

  // Activity bar with playhead
  const activity = renderActivityWithPlayhead(report, cursorEvent);
  lines.push('activity:');
  lines.push('  ' + activity.bar);
  lines.push('  ' + activity.playhead);
  lines.push('  ' + activity.axis);
  lines.push('');

  // Active block
  const activeBlock = findActiveBlock(report, cursorEvent);
  if (activeBlock) {
    const cursorTs = Date.parse(cursorEvent.timestamp);
    const eventsBefore = activeBlock.events.filter((e) => Date.parse(e.timestamp) <= cursorTs).length;
    lines.push(`active block: ${activeBlock.label.toLowerCase()} · ${formatTime(activeBlock.start)} → ${formatTime(activeBlock.end)} (${eventsBefore}/${activeBlock.eventCount} events)`);
    lines.push(`              ${activeBlock.dominantModel} · cache hit-rate trend ${formatTrend(activeBlock.cacheHitRateTrend)} · block cost ${formatCost(activeBlock.cost)}`);
  } else {
    lines.push('active block: idle · between blocks');
  }
  lines.push('');

  // Events near cursor
  lines.push('events near cursor:');
  const start = Math.max(0, ctx.cursorIndex - 2);
  const end = Math.min(report.events.length, ctx.cursorIndex + 3);
  for (let i = start; i < end; i++) {
    const e = report.events[i];
    const marker = i === ctx.cursorIndex ? '▶' : ' ';
    const cr = e.inputTokens + e.cacheReadTokens > 0 ? e.cacheReadTokens / (e.inputTokens + e.cacheReadTokens) : 0;
    lines.push(` ${marker} ${formatTimeSeconds(e.timestamp).padEnd(9)} ${truncate(e.model, 22).padEnd(22)} ${formatTokens(e.totalTokens).padStart(8)} tok  cache ${formatPercent(cr).padStart(5)}  ${formatCost(e.cost).padStart(8)}`);
  }
  lines.push('');

  // Model mix bar chart
  lines.push('model mix (cumulative):');
  const totalMix = Array.from(ctx.modelMix.values()).reduce((s, v) => s + v, 0) || 1;
  const sortedMix = Array.from(ctx.modelMix.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const barColumnWidth = 24;
  for (const [model, tokens] of sortedMix) {
    const pct = tokens / totalMix;
    const filled = Math.max(1, Math.round(pct * barColumnWidth));
    const bar = '█'.repeat(filled) + ' '.repeat(barColumnWidth - filled);
    lines.push(`  ${truncate(model, 18).padEnd(18)}  ${bar}  ${(pct * 100).toFixed(0).padStart(3)}%`);
  }

  return lines.map((l) => l.padEnd(ctx.width).slice(0, ctx.width)).join('\r\n');
}

function renderActivityWithPlayhead(report: ReplayReport, cursorEvent: UsageEvent) {
  const slotTokens = new Array<number>(HEATMAP_SLOTS).fill(0);
  for (const e of report.events) {
    const d = new Date(e.timestamp);
    const slot = Math.min(d.getHours() * 2 + Math.floor(d.getMinutes() / 30), HEATMAP_SLOTS - 1);
    slotTokens[slot] += e.totalTokens;
  }
  const max = Math.max(...slotTokens);
  let bar = '';
  for (let i = 0; i < HEATMAP_SLOTS; i++) {
    const level = max > 0 ? Math.round((slotTokens[i] / max) * (HEATMAP_BLOCKS.length - 1)) : 0;
    bar += HEATMAP_BLOCKS[level];
  }
  const cursorD = new Date(cursorEvent.timestamp);
  const cursorSlot = Math.min(cursorD.getHours() * 2 + Math.floor(cursorD.getMinutes() / 30), HEATMAP_SLOTS - 1);
  const playhead = ' '.repeat(cursorSlot) + '▼';
  const firstTime = formatTime(report.events[0].timestamp);
  const lastTime = formatTime(report.events[report.events.length - 1].timestamp);
  const axis = `${firstTime}${' '.repeat(Math.max(1, HEATMAP_SLOTS - firstTime.length - lastTime.length))}${lastTime}`;
  return { bar, playhead, axis };
}

function findActiveBlock(report: ReplayReport, cursorEvent: UsageEvent) {
  const ts = Date.parse(cursorEvent.timestamp);
  for (const b of report.flowBlocks) {
    if (ts >= Date.parse(b.start) && ts <= Date.parse(b.end)) return b;
  }
  return null;
}

function renderEmptyFrame(report: ReplayReport, width: number): string {
  const header = `tokenleak replay · ${report.date}`;
  return [
    header.padEnd(width).slice(0, width),
    ''.padEnd(width),
    `(no events on ${report.date})`.padEnd(width).slice(0, width),
  ].join('\r\n');
}

// ── Formatting helpers (local copies; kept simple to avoid TUI dep here) ────

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTimeSeconds(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatTrend(trend: number[]): string {
  if (trend.length === 0) return '—';
  if (trend.length === 1) return formatPercent(trend[0]);
  const first = formatPercent(trend[0]);
  const last = formatPercent(trend[trend.length - 1]);
  const direction = trend[trend.length - 1] > trend[0] + 0.05 ? '↑' : trend[trend.length - 1] < trend[0] - 0.05 ? '↓' : '→';
  return `${first} ${direction} ${last}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return '';
  return s.slice(0, max - 1) + '…';
}

function padBetween(left: string, right: string, width: number): string {
  if (left.length + right.length + 1 >= width) {
    return (left + ' ' + right).padEnd(width).slice(0, width);
  }
  const pad = width - left.length - right.length;
  return left + ' '.repeat(pad) + right;
}
