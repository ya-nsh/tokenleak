import { Box, Text } from '@opentui/core';
import type { FlowBlock, ReplayReport, TokenVelocityPoint, UsageEvent } from '@tokenleak/core';
import { formatCost, formatTokens, formatPercent, formatShortDate, padRight, padLeft, truncate, wrapText } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { PlaybackSummary } from '../lib/replay-playback.js';

const HEATMAP_BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const HEATMAP_SLOTS = 48;
export const REPLAY_MAX_CONTENT_WIDTH = 78;
const REPLAY_EVENT_DETAIL_LIMIT = 4;
export const REPLAY_VISIBLE_BLOCKS = 8;
/** Tighter list during playback so the events-near-cursor section fits. */
export const REPLAY_VISIBLE_BLOCKS_PLAYBACK = 3;
const PLAYBACK_EVENT_LIST_BEFORE = 2;
const PLAYBACK_EVENT_LIST_AFTER = 4;

type ReplayToggleHandler = (blockIndex: number) => void;

export interface ReplayPlaybackView {
  cursorIndex: number;
  active: boolean;
  speed: number;
  summary: PlaybackSummary;
  totalDayCost: number;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTimeSeconds(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Activity bar with an optional ▼ playhead column. */
function renderActivityBar(report: ReplayReport, playback: ReplayPlaybackView | null) {
  if (report.events.length === 0) {
    return Text({ content: '  (no events)', fg: COLORS.dimWhite });
  }

  const slotTokens = new Array<number>(HEATMAP_SLOTS).fill(0);
  for (const event of report.events) {
    const date = new Date(event.timestamp);
    const slot = Math.min(date.getHours() * 2 + Math.floor(date.getMinutes() / 30), HEATMAP_SLOTS - 1);
    slotTokens[slot] += event.totalTokens;
  }

  const maxTokens = Math.max(...slotTokens);
  let bar = '';
  for (let i = 0; i < HEATMAP_SLOTS; i++) {
    const level = maxTokens > 0 ? Math.round((slotTokens[i] / maxTokens) * (HEATMAP_BLOCKS.length - 1)) : 0;
    bar += HEATMAP_BLOCKS[level];
  }

  const firstTime = formatTime(report.events[0].timestamp);
  const lastTime = formatTime(report.events[report.events.length - 1].timestamp);

  const children: ReturnType<typeof Text>[] = [];
  if (playback) {
    const cursorEvent = playback.summary.cursorEvent;
    const date = new Date(cursorEvent.timestamp);
    const slot = Math.min(date.getHours() * 2 + Math.floor(date.getMinutes() / 30), HEATMAP_SLOTS - 1);
    const playhead = ' '.repeat(slot) + '▼';
    children.push(Text({ content: playhead, fg: COLORS.amber, attributes: BOLD }));
  }
  children.push(Text({ content: bar, fg: COLORS.green }));
  children.push(Text({ content: `${firstTime}${' '.repeat(Math.max(1, HEATMAP_SLOTS - firstTime.length - lastTime.length))}${lastTime}`, fg: COLORS.dimWhite }));

  return Box({ flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 }, ...children);
}

function renderDetailLine(content: string, contentWidth: number, fg: string = COLORS.dimWhite) {
  return Text({ content: truncate(`    ${content}`, contentWidth), fg });
}

function renderFlowBlockCard(
  block: FlowBlock,
  selected: boolean,
  expanded: boolean,
  active: boolean,
  contentWidth: number,
  onToggleBlock?: ReplayToggleHandler,
) {
  const timeRange = `${formatTime(block.start)}–${formatTime(block.end)}`;
  const headerText = `${timeRange}  ${block.label}  |  ${block.eventCount} events  |  ${formatTokens(block.totalTokens)} tok  |  ${formatCost(block.cost)}`;
  const cursor = active ? '▶' : selected ? '▸' : ' ';
  const expandIcon = expanded ? '▼' : '▶';

  const headerFg = active
    ? COLORS.amber
    : block.label === 'Deep Flow' ? COLORS.cyan : block.label === 'Quick Lookup' ? COLORS.dimWhite : COLORS.white;
  const headerLine = Text({
    content: truncate(` ${cursor} ${expandIcon} ${headerText}`, contentWidth),
    fg: headerFg,
    attributes: BOLD,
  });

  if (!expanded) {
    return Box(
      {
        flexDirection: 'column',
        width: '100%',
        onMouseDown: onToggleBlock ? () => onToggleBlock(block.blockIndex) : undefined,
      },
      headerLine,
    );
  }

  const children = [headerLine];

  const switchText = block.modelSwitches > 0
    ? `, ${block.modelSwitches} switch${block.modelSwitches === 1 ? '' : 'es'}`
    : '';
  children.push(renderDetailLine(`Model: ${block.dominantModel}${switchText}`, contentWidth, COLORS.white));
  children.push(renderDetailLine(
    `Input ${formatTokens(block.inputTokens)} | Output ${formatTokens(block.outputTokens)} | Cache read ${formatTokens(block.cacheReadTokens)} | Cache write ${formatTokens(block.cacheWriteTokens)}`,
    contentWidth,
  ));

  const events = block.events.slice(0, REPLAY_EVENT_DETAIL_LIMIT);
  for (const event of events) {
    const time = formatTime(event.timestamp);
    const cacheRate = (event.inputTokens + event.cacheReadTokens) > 0
      ? event.cacheReadTokens / (event.inputTokens + event.cacheReadTokens)
      : 0;
    const line = `${padRight(time, 6)} ${padRight(truncate(event.model, 20), 21)} ${padLeft(formatTokens(event.totalTokens), 8)} tok  cache ${padLeft(formatPercent(cacheRate), 6)}  ${padLeft(formatCost(event.cost), 8)}`;
    children.push(renderDetailLine(line, contentWidth, COLORS.white));
  }
  const hiddenEventCount = block.events.length - events.length;
  if (hiddenEventCount > 0) {
    children.push(renderDetailLine(`+${hiddenEventCount} more events`, contentWidth, COLORS.dimWhite));
  }

  const trend = block.cacheHitRateTrend;
  if (trend.length > 1) {
    const first = (trend[0] * 100).toFixed(0);
    const last = (trend[trend.length - 1] * 100).toFixed(0);
    if (first !== last) {
      const direction = Number(last) > Number(first) ? '↑' : '↓';
      children.push(
        renderDetailLine(
          `Cache trend: ${first}% → ${last}% ${direction}`,
          contentWidth,
          Number(last) > Number(first) ? COLORS.green : COLORS.red,
        ),
      );
    }
  }

  children.push(Text({ content: '', fg: COLORS.dimWhite }));

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      onMouseDown: onToggleBlock ? () => onToggleBlock(block.blockIndex) : undefined,
    },
    ...children,
  );
}

function renderPulseChart(velocity: TokenVelocityPoint[]) {
  if (velocity.length === 0) {
    return Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({ content: 'Pulse', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: '  (no data)', fg: COLORS.dimWhite }),
    );
  }

  const maxTpm = Math.max(...velocity.map((v) => v.tokensPerMinute));
  const chartWidth = Math.min(velocity.length, 60);
  const chartHeight = 5;
  const step = velocity.length / chartWidth;

  const rows: string[] = [];
  for (let row = 0; row < chartHeight; row++) {
    let line = '';
    for (let col = 0; col < chartWidth; col++) {
      const idx = Math.floor(col * step);
      const tpm = velocity[idx].tokensPerMinute;
      const normalizedHeight = maxTpm > 0 ? (tpm / maxTpm) * (chartHeight - 1) : 0;
      const threshold = chartHeight - 1 - row;
      line += normalizedHeight >= threshold ? '█' : ' ';
    }
    rows.push(line);
  }

  const children = [
    Text({ content: 'Pulse (tok/min)', fg: COLORS.amber, attributes: BOLD }),
  ];

  for (let i = 0; i < rows.length; i++) {
    const label = i === 0 ? padLeft(formatTokens(maxTpm), 7) : i === rows.length - 1 ? padLeft('0', 7) : '       ';
    children.push(
      Text({ content: `${label} │${rows[i]}`, fg: COLORS.green }),
    );
  }

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    ...children,
  );
}

function renderDaySummary(report: ReplayReport, contentWidth: number) {
  const s = report.summary;
  const parts = [
    `Sessions: ${s.totalSessions}`,
    `Events: ${s.totalEvents}`,
    `Flow: ${formatDuration(s.flowTimeMs)}`,
    `Think: ${formatDuration(s.thinkTimeMs)}`,
    `Ratio: ${(s.flowThinkRatio * 100).toFixed(0)}%`,
  ];
  if (s.peakMinute) {
    parts.push(`Peak: ${formatTokens(s.peakMinute.tokensPerMinute)} tok/min at ${formatTime(s.peakMinute.minute)}`);
  }

  const lines = wrapText(parts.join('  |  '), contentWidth - 2, 2);
  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    ...lines.map((line) => Text({ content: line, fg: COLORS.white })),
  );
}

function renderPlaybackHeader(playback: ReplayPlaybackView, totalEvents: number, contentWidth: number) {
  const status = playback.active
    ? `▶ playing ${playback.speed}×`
    : `⏸ paused @ ${formatTimeSeconds(playback.summary.cursorEvent.timestamp)}`;
  const statusColor = playback.active ? COLORS.green : COLORS.amber;
  const cost = `${formatCost(playback.summary.cumulativeCost)}/${formatCost(playback.totalDayCost)}`;
  const counter = `event ${playback.summary.cursorIndex + 1}/${totalEvents}`;
  const cacheBit = `cache ${formatPercent(playback.summary.cacheHitRate)}`;
  const left = `${cost}  ·  ${counter}  ·  ${cacheBit}`;
  const composed = `${left}     ${status}`;
  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: truncate(composed, contentWidth), fg: statusColor, attributes: BOLD }),
  );
}

function renderPlaybackEventList(report: ReplayReport, playback: ReplayPlaybackView, contentWidth: number) {
  const start = Math.max(0, playback.cursorIndex - PLAYBACK_EVENT_LIST_BEFORE);
  const end = Math.min(report.events.length, playback.cursorIndex + PLAYBACK_EVENT_LIST_AFTER + 1);
  const lines: ReturnType<typeof Text>[] = [
    Text({ content: ' Events near cursor', fg: COLORS.amber, attributes: BOLD }),
  ];
  for (let i = start; i < end; i++) {
    const e: UsageEvent = report.events[i];
    const isCursor = i === playback.cursorIndex;
    const isFuture = i > playback.cursorIndex;
    const cacheRate = (e.inputTokens + e.cacheReadTokens) > 0
      ? e.cacheReadTokens / (e.inputTokens + e.cacheReadTokens)
      : 0;
    const marker = isCursor ? '▶' : ' ';
    const line = ` ${marker} ${padRight(formatTimeSeconds(e.timestamp), 9)} ${padRight(truncate(e.model, 22), 23)} ${padLeft(formatTokens(e.totalTokens), 8)} tok  cache ${padLeft(formatPercent(cacheRate), 5)}  ${padLeft(formatCost(e.cost), 8)}`;
    const fg = isCursor ? COLORS.green : isFuture ? COLORS.dimWhite : COLORS.white;
    const attributes = isCursor ? BOLD : undefined;
    lines.push(Text({ content: truncate(line, contentWidth), fg, attributes }));
  }
  return Box({ flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 }, ...lines);
}

function renderPlaybackHelp(contentWidth: number) {
  // One row only — opentui flex compresses sibling rows when content overflows
  // the parent height. Two-line help collapsed onto each other in a real
  // terminal screenshot; keep it lean so the panel never overruns.
  const line = ' [n/p] step · [N/P] block · [i] interesting · [space] play · [1/2/3] speed · [s] exit';
  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: truncate(line, contentWidth), fg: COLORS.dimWhite }),
  );
}

function renderOverviewHelp(contentWidth: number) {
  const line = ' [s] enter step/playback · [n/p] step · [space] play · [i] interesting · [o] open browser';
  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: truncate(line, contentWidth), fg: COLORS.dimWhite }),
  );
}

/**
 * Big "press [o] to open the interactive browser scrub" banner. Always
 * shown above the playback header in BOTH overview and playback modes —
 * the browser experience is the better one for visual scrubbing and we
 * want it discoverable from anywhere on this view.
 *
 * When `liveServerPort` is set, swaps to a one-line success state.
 */
function renderBrowserBanner(contentWidth: number, liveServerPort: number | null) {
  if (liveServerPort !== null) {
    const status = ` ✓ browser open at http://localhost:${liveServerPort}/  ·  press [o] again to re-open`;
    return Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({ content: truncate(status, contentWidth), fg: COLORS.green, attributes: BOLD }),
    );
  }
  const inner = '  ▶  press [o] to open the interactive browser scrub  ⟶';
  const innerWidth = Math.min(contentWidth - 2, 60);
  const top = '╭' + '─'.repeat(innerWidth) + '╮';
  const middle = '│' + truncate(inner.padEnd(innerWidth), innerWidth) + '│';
  const bottom = '╰' + '─'.repeat(innerWidth) + '╯';
  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: top, fg: COLORS.green }),
    Text({ content: middle, fg: COLORS.green, attributes: BOLD }),
    Text({ content: bottom, fg: COLORS.green }),
  );
}

export function createReplayPanel(
  report: ReplayReport | null,
  replayDate: string | null,
  selectedBlockIndex: number,
  expandedBlockIndex: number | null,
  scrollOffset: number,
  contentWidth: number = REPLAY_MAX_CONTENT_WIDTH,
  onToggleBlock?: ReplayToggleHandler,
  playback: ReplayPlaybackView | null = null,
  liveServerPort: number | null = null,
) {
  const dateLabel = replayDate ? formatShortDate(replayDate) : '—';

  if (!report) {
    return Box(
      {
        flexDirection: 'column',
        width: '100%',
        flexGrow: 1,
        borderStyle: 'single',
        borderColor: COLORS.dimWhite,
        paddingLeft: 1,
        paddingRight: 1,
      },
      Text({
        content: ` Replay: ${dateLabel} ◄ ► `,
        fg: COLORS.amber,
        attributes: BOLD,
      }),
      Text({ content: '', fg: COLORS.dimWhite }),
      renderBrowserBanner(contentWidth, liveServerPort),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: 'No data available for this date', fg: COLORS.dimWhite }),
    );
  }

  // Playback mode trims the panel: dropping the pulse chart + day summary
  // and shrinking the flow-block list keeps total rows ≲ 22 so opentui's
  // flex layout never compresses sibling Text rows on top of each other.
  const visibleBlocks = playback ? REPLAY_VISIBLE_BLOCKS_PLAYBACK : REPLAY_VISIBLE_BLOCKS;
  const totalCost = report.events.reduce((sum, e) => sum + e.cost, 0);
  const safeOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, report.flowBlocks.length - visibleBlocks)));
  const blockCards = report.flowBlocks
    .slice(safeOffset, safeOffset + visibleBlocks)
    .map((block) => renderFlowBlockCard(
      block,
      block.blockIndex === selectedBlockIndex,
      block.blockIndex === expandedBlockIndex,
      playback !== null && block.blockIndex === selectedBlockIndex,
      contentWidth,
      onToggleBlock,
    ));

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (safeOffset > 0) {
    scrollIndicators.push(Text({ content: `  ${safeOffset} more above`, fg: COLORS.dimWhite }));
  }
  const below = report.flowBlocks.length - safeOffset - blockCards.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  const titleSuffix = playback ? '  [PLAYBACK]' : '';
  const playbackHeader = playback ? renderPlaybackHeader(playback, report.events.length, contentWidth) : null;
  const playbackEvents = playback ? renderPlaybackEventList(report, playback, contentWidth) : null;
  const help = playback ? renderPlaybackHelp(contentWidth) : renderOverviewHelp(contentWidth);

  const children: ReturnType<typeof Box | typeof Text>[] = [
    Text({
      content: ` Replay: ${dateLabel} ◄ ►${titleSuffix}`,
      fg: COLORS.amber,
      attributes: BOLD,
    }),
    Box(
      { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({ content: `Total: ${formatCost(totalCost)}`, fg: COLORS.green }),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    renderBrowserBanner(contentWidth, liveServerPort),
  ];
  if (playbackHeader) {
    children.push(Text({ content: '', fg: COLORS.dimWhite }));
    children.push(playbackHeader);
  }
  children.push(Text({ content: '', fg: COLORS.dimWhite }));
  children.push(renderActivityBar(report, playback));
  children.push(Text({ content: '', fg: COLORS.dimWhite }));
  children.push(
    Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({
        content: `Flow Blocks (${report.flowBlocks.length})`,
        fg: COLORS.amber,
        attributes: BOLD,
      }),
    ),
  );
  children.push(...blockCards);
  children.push(...scrollIndicators);
  if (playbackEvents) {
    children.push(Text({ content: '', fg: COLORS.dimWhite }));
    children.push(playbackEvents);
  }
  if (!playback) {
    children.push(Text({ content: '', fg: COLORS.dimWhite }));
    children.push(renderPulseChart(report.tokenVelocity));
    children.push(Text({ content: '', fg: COLORS.dimWhite }));
    children.push(renderDaySummary(report, contentWidth));
  }
  children.push(Text({ content: '', fg: COLORS.dimWhite }));
  children.push(help);

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    ...children,
  );
}
