import { Box, Text } from '@opentui/core';
import type { FocusEntry, FocusReport } from '@tokenleak/core';
import { formatCost, formatTokens, formatShortDate, asciiBar, padRight, padLeft, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

const VISIBLE_ROWS = 12;
const MAX_ENTRIES = 20;

function formatHours(ms: number | null): string {
  if (ms === null || ms <= 0) return '0.0h';
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatTokPerHour(tokPerHour: number): string {
  return `${formatTokens(tokPerHour)}/hr`;
}

function renderEntry(entry: FocusEntry, rank: number) {
  const barWidth = 10;
  const ratio = Math.min(entry.score / 100, 1);
  const bar = asciiBar(ratio, barWidth);

  const rankStr = padLeft(`${rank}.`, 3);
  const scoreStr = padLeft(`${Math.round(entry.score)}`, 4);
  const label = truncate(entry.label || entry.sessionId, 20);
  const startDate = entry.start ? formatShortDate(entry.start.slice(0, 10)) : '';
  const duration = formatHours(entry.durationMs);
  const density = formatTokPerHour(entry.tokensPerHour);
  const cost = formatCost(entry.cost);

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Box(
      { flexDirection: 'row', width: '100%' },
      Text({ content: `${rankStr} `, fg: COLORS.dimWhite }),
      Text({ content: bar, fg: COLORS.green }),
      Text({ content: ` ${scoreStr}  `, fg: COLORS.amber, attributes: BOLD }),
      Text({ content: padRight(label, 22), fg: COLORS.white }),
      Text({ content: padLeft(startDate, 8), fg: COLORS.dimWhite }),
      Text({ content: padLeft(duration, 7), fg: COLORS.cyan }),
      Text({ content: padLeft(density, 13), fg: COLORS.green }),
      Text({ content: padLeft(cost, 10), fg: COLORS.amber }),
    ),
    Text({
      content: `      \u2192 ${entry.rationale.join('; ')}`,
      fg: COLORS.dimWhite,
    }),
  );
}

export function createFocusPanel(state: AppState, report: FocusReport | null) {
  if (!report || report.entries.length === 0) {
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
      Text({ content: ' Focus Sessions ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({
        content: 'No session data available. Focus requires event-level provider data.',
        fg: COLORS.dimWhite,
      }),
    );
  }

  const entries = report.entries.slice(0, MAX_ENTRIES);
  const offset = state.focusScrollOffset;
  const visible = entries.slice(offset, offset + VISIBLE_ROWS);

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = entries.length - offset - visible.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  // Column header
  const columnHeader = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: padRight('', 4), fg: COLORS.dimWhite }),
    Text({ content: padRight('', 10), fg: COLORS.dimWhite }),
    Text({ content: padRight('Score', 6), fg: COLORS.dimWhite }),
    Text({ content: padRight('Session', 22), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Date', 8), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Dur', 7), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Density', 13), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Cost', 10), fg: COLORS.dimWhite }),
  );

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({ content: ' Focus Sessions ', fg: COLORS.amber, attributes: BOLD }),
    Box(
      { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({
        content: `Scoring: ${report.method}`,
        fg: COLORS.dimWhite,
      }),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    columnHeader,
    ...visible.map((e, i) => renderEntry(e, offset + i + 1)),
    ...scrollIndicators,
  );
}
