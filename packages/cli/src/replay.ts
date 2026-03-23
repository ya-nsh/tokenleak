import type { FlowBlock, ReplayReport, TokenVelocityPoint } from '@tokenleak/core';

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(tokens)}`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0s';
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  if (width <= 3) {
    return '.'.repeat(Math.max(0, width));
  }
  return `${value.slice(0, width - 3)}...`;
}

const HEATMAP_SLOTS = 48;
const HEATMAP_BLOCKS = [' ', '\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function renderActivityBar(report: ReplayReport, width: number): string[] {
  if (report.events.length === 0) {
    return ['Activity', '  (no events)'];
  }

  const slotTokens = new Array<number>(HEATMAP_SLOTS).fill(0);

  for (const event of report.events) {
    const date = new Date(event.timestamp);
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const slot = Math.min(hour * 2 + Math.floor(minute / 30), HEATMAP_SLOTS - 1);
    slotTokens[slot] += event.totalTokens;
  }

  const maxTokens = Math.max(...slotTokens);
  const barWidth = Math.min(HEATMAP_SLOTS, width - 4);
  const step = HEATMAP_SLOTS / barWidth;

  let bar = '  ';
  for (let i = 0; i < barWidth; i++) {
    const slotIndex = Math.floor(i * step);
    const tokens = slotTokens[slotIndex];
    const level = maxTokens > 0 ? Math.round((tokens / maxTokens) * (HEATMAP_BLOCKS.length - 1)) : 0;
    bar += HEATMAP_BLOCKS[level];
  }

  const firstTime = formatTime(report.events[0].timestamp);
  const lastTime = formatTime(report.events[report.events.length - 1].timestamp);
  const timeLabel = `  ${firstTime}${' '.repeat(Math.max(1, barWidth - firstTime.length - lastTime.length))}${lastTime}`;

  return ['Activity', bar, timeLabel];
}

function renderFlowBlockCard(block: FlowBlock, width: number): string[] {
  const timeRange = `${formatTime(block.start)}-${formatTime(block.end)}`;
  const header = `  [${timeRange}] ${block.label} | ${block.eventCount} events | ${formatTokens(block.totalTokens)} tok | ${formatCost(block.cost)}`;

  const lines = [truncate(header, width)];

  const modelInfo = `    Model: ${block.dominantModel}${block.modelSwitches > 0 ? ` (${block.modelSwitches} switch${block.modelSwitches === 1 ? '' : 'es'})` : ''}`;
  lines.push(truncate(modelInfo, width));

  const trend = block.cacheHitRateTrend;
  if (trend.length > 0) {
    const firstRate = (trend[0] * 100).toFixed(0);
    const lastRate = (trend[trend.length - 1] * 100).toFixed(0);
    if (trend.length > 1 && firstRate !== lastRate) {
      lines.push(`    Cache: ${firstRate}% -> ${lastRate}%`);
    } else {
      lines.push(`    Cache: ${firstRate}%`);
    }
  }

  return lines;
}

function renderPulseChart(velocity: TokenVelocityPoint[], width: number): string[] {
  if (velocity.length === 0) {
    return ['Pulse', '  (no data)'];
  }

  const maxTpm = Math.max(...velocity.map((v) => v.tokensPerMinute));
  const chartWidth = Math.min(velocity.length, width - 10);
  const chartHeight = 5;
  const step = velocity.length / chartWidth;

  const grid: string[][] = [];
  for (let row = 0; row < chartHeight; row++) {
    grid.push(new Array<string>(chartWidth).fill(' '));
  }

  for (let col = 0; col < chartWidth; col++) {
    const idx = Math.floor(col * step);
    const tpm = velocity[idx].tokensPerMinute;
    const height = maxTpm > 0 ? Math.round((tpm / maxTpm) * (chartHeight - 1)) : 0;
    for (let row = chartHeight - 1; row >= chartHeight - 1 - height; row--) {
      if (row >= 0) {
        grid[row][col] = '\u2588';
      }
    }
  }

  const lines = ['Pulse (tokens/min)'];
  const maxLabel = formatTokens(maxTpm);
  for (let row = 0; row < chartHeight; row++) {
    const label = row === 0 ? maxLabel.padStart(7) : row === chartHeight - 1 ? '      0' : '       ';
    lines.push(`${label} |${grid[row].join('')}`);
  }

  return lines;
}

export function renderReplayTerminal(report: ReplayReport, width: number = 80): string {
  const lines: string[] = [
    `Session Replay: ${report.date}`,
    '',
  ];

  lines.push(...renderActivityBar(report, width));
  lines.push('');

  if (report.flowBlocks.length === 0) {
    lines.push('Flow Blocks', '  (no activity)');
  } else {
    lines.push(`Flow Blocks (${report.flowBlocks.length})`);
    for (const block of report.flowBlocks) {
      lines.push(...renderFlowBlockCard(block, width));
      lines.push('');
    }
  }

  lines.push(...renderPulseChart(report.tokenVelocity, width));
  lines.push('');

  const s = report.summary;
  const summaryParts = [
    `Sessions: ${s.totalSessions}`,
    `Events: ${s.totalEvents}`,
    `Flow: ${formatDuration(s.flowTimeMs)}`,
    `Think: ${formatDuration(s.thinkTimeMs)}`,
    `Ratio: ${(s.flowThinkRatio * 100).toFixed(0)}%`,
  ];
  if (s.peakMinute) {
    summaryParts.push(`Peak: ${formatTokens(s.peakMinute.tokensPerMinute)} tok/min at ${formatTime(s.peakMinute.minute)}`);
  }
  lines.push(truncate(summaryParts.join(' | '), width));

  return lines.join('\n');
}

export function buildReplayHelpText(): string {
  return [
    'Usage:',
    '  tokenleak replay [date] [flags]',
    '',
    'Arguments:',
    '  date                    Date to replay in YYYY-MM-DD format (defaults to today)',
    '',
    'Replay Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -o, --output <path>     Write output to a file and infer format from extension',
    '  -w, --width <number>    Terminal render width',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --claude            Only include Claude Code',
    '      --codex             Only include Codex',
    '      --cursor            Only include Cursor',
    '      --pi                Only include Pi',
    '      --open-code         Only include OpenCode',
    '      --all-providers     Ignore provider filters and use every available provider',
    '      --no-color          Accepted for parity with terminal output',
    '      --help              Show replay help',
    '',
    'Examples:',
    '  tokenleak replay',
    '  tokenleak replay 2026-03-10',
    '  tokenleak replay 2026-03-10 --format json',
    '  tokenleak replay --provider claude --output replay.json',
    '',
  ].join('\n');
}
