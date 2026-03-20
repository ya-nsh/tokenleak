import { Box, Text } from '@opentui/core';
import type { HourOfDayEntry, DayOfWeekEntry } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatTokens, padRight, padLeft, asciiBar } from '../lib/format.js';

/** Hour-of-day panel: 24-row horizontal bar chart */
export function createHourOfDayPanel(hourOfDay: HourOfDayEntry[]) {
  const maxTokens = Math.max(...hourOfDay.map((h) => h.tokens), 1);

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  // Show all 24 hours — will clip if terminal is short
  for (const entry of hourOfDay) {
    const ratio = entry.tokens / maxTokens;
    const hourLabel = String(entry.hour).padStart(2, '0');
    const barColor = entry.tokens === maxTokens ? COLORS.amber : COLORS.green;

    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: `${hourLabel} `, fg: COLORS.dimWhite }),
        Text({ content: asciiBar(ratio, 16), fg: barColor }),
        Text({ content: ` ${padLeft(formatTokens(entry.tokens), 8)}`, fg: COLORS.green }),
      ),
    );
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.cyan,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' HOUR OF DAY ', fg: COLORS.cyan, attributes: BOLD }),
    ...children,
  );
}

/** Day-of-week panel: 7-row horizontal bar chart */
export function createDayOfWeekPanel(dayOfWeek: DayOfWeekEntry[]) {
  const maxTokens = Math.max(...dayOfWeek.map((d) => d.tokens), 1);

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  for (const entry of dayOfWeek) {
    const ratio = entry.tokens / maxTokens;
    const barColor = entry.tokens === maxTokens ? COLORS.amber : COLORS.green;

    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight(entry.label, 4), fg: COLORS.dimWhite }),
        Text({ content: asciiBar(ratio, 16), fg: barColor }),
        Text({ content: ` ${padLeft(formatTokens(entry.tokens), 8)}`, fg: COLORS.green }),
      ),
    );
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.magenta,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' DAY OF WEEK ', fg: COLORS.magenta, attributes: BOLD }),
    ...children,
  );
}
