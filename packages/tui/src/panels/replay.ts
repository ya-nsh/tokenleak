import { Box, Text } from '@opentui/core';
import type { FlowBlock, ReplayReport, TokenVelocityPoint } from '@tokenleak/core';
import { formatCost, formatTokens, formatPercent, formatShortDate, padRight, padLeft, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

const HEATMAP_BLOCKS = [' ', '\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];
const HEATMAP_SLOTS = 48;

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function renderActivityBar(report: ReplayReport) {
  if (report.events.length === 0) {
    return Text({ content: '  (no events)', fg: COLORS.dimWhite });
  }

  const slotTokens = new Array<number>(HEATMAP_SLOTS).fill(0);
  for (const event of report.events) {
    const date = new Date(event.timestamp);
    const slot = Math.min(date.getUTCHours() * 2 + Math.floor(date.getUTCMinutes() / 30), HEATMAP_SLOTS - 1);
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

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: bar, fg: COLORS.green }),
    Text({ content: `${firstTime}${' '.repeat(Math.max(1, HEATMAP_SLOTS - firstTime.length - lastTime.length))}${lastTime}`, fg: COLORS.dimWhite }),
  );
}

function renderFlowBlockCard(block: FlowBlock, expanded: boolean) {
  const timeRange = `${formatTime(block.start)}\u2013${formatTime(block.end)}`;
  const headerText = `${timeRange}  ${block.label}  |  ${block.eventCount} events  |  ${formatTokens(block.totalTokens)} tok  |  ${formatCost(block.cost)}`;
  const expandIcon = expanded ? '\u25BC' : '\u25B6';

  const headerLine = Text({
    content: `  ${expandIcon} ${headerText}`,
    fg: block.label === 'Deep Flow' ? COLORS.cyan : block.label === 'Quick Lookup' ? COLORS.dimWhite : COLORS.white,
    attributes: BOLD,
  });

  if (!expanded) {
    return Box({ flexDirection: 'column', width: '100%' }, headerLine);
  }

  const children = [headerLine];

  children.push(
    Text({
      content: `    Model: ${block.dominantModel}${block.modelSwitches > 0 ? ` (${block.modelSwitches} switch${block.modelSwitches === 1 ? '' : 'es'})` : ''}`,
      fg: COLORS.white,
    }),
  );

  for (const event of block.events) {
    const time = formatTime(event.timestamp);
    const cacheRate = (event.inputTokens + event.cacheReadTokens) > 0
      ? event.cacheReadTokens / (event.inputTokens + event.cacheReadTokens)
      : 0;
    const line = `    ${padRight(time, 7)} ${padRight(truncate(event.model, 18), 19)} ${padLeft(formatTokens(event.totalTokens), 8)}  cache:${formatPercent(cacheRate).padStart(4)}  ${formatCost(event.cost).padStart(8)}`;
    children.push(
      Text({ content: line, fg: COLORS.white }),
    );
  }

  const trend = block.cacheHitRateTrend;
  if (trend.length > 1) {
    const first = (trend[0] * 100).toFixed(0);
    const last = (trend[trend.length - 1] * 100).toFixed(0);
    if (first !== last) {
      const direction = Number(last) > Number(first) ? '\u2191' : '\u2193';
      children.push(
        Text({
          content: `    Cache: ${first}% \u2192 ${last}% ${direction}`,
          fg: Number(last) > Number(first) ? COLORS.green : COLORS.red,
        }),
      );
    }
  }

  children.push(Text({ content: '', fg: COLORS.dimWhite }));

  return Box({ flexDirection: 'column', width: '100%' }, ...children);
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
      line += normalizedHeight >= threshold ? '\u2588' : ' ';
    }
    rows.push(line);
  }

  const children = [
    Text({ content: 'Pulse (tok/min)', fg: COLORS.amber, attributes: BOLD }),
  ];

  for (let i = 0; i < rows.length; i++) {
    const label = i === 0 ? padLeft(formatTokens(maxTpm), 7) : i === rows.length - 1 ? padLeft('0', 7) : '       ';
    children.push(
      Text({ content: `${label} \u2502${rows[i]}`, fg: COLORS.green }),
    );
  }

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    ...children,
  );
}

function renderDaySummary(report: ReplayReport) {
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

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: parts.join('  |  '), fg: COLORS.white }),
  );
}

export function createReplayPanel(
  report: ReplayReport | null,
  replayDate: string | null,
  expandedBlocks: Set<number>,
  scrollOffset: number,
) {
  const dateLabel = replayDate ? formatShortDate(replayDate) : '\u2014';

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
        content: ` Replay: ${dateLabel} \u25C4 \u25BA `,
        fg: COLORS.amber,
        attributes: BOLD,
      }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: 'No data available for this date', fg: COLORS.dimWhite }),
    );
  }

  const totalCost = report.events.reduce((sum, e) => sum + e.cost, 0);
  const blockCards = report.flowBlocks
    .slice(scrollOffset, scrollOffset + 20)
    .map((block) => renderFlowBlockCard(block, expandedBlocks.has(block.blockIndex)));

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({
      content: ` Replay: ${dateLabel} \u25C4 \u25BA `,
      fg: COLORS.amber,
      attributes: BOLD,
    }),
    Box(
      { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({ content: `Total: ${formatCost(totalCost)}`, fg: COLORS.green }),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    renderActivityBar(report),
    Text({ content: '', fg: COLORS.dimWhite }),
    Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({
        content: `Flow Blocks (${report.flowBlocks.length})`,
        fg: COLORS.amber,
        attributes: BOLD,
      }),
    ),
    ...blockCards,
    Text({ content: '', fg: COLORS.dimWhite }),
    renderPulseChart(report.tokenVelocity),
    Text({ content: '', fg: COLORS.dimWhite }),
    renderDaySummary(report),
  );
}
