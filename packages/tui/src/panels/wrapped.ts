import { Box, Text } from '@opentui/core';
import type { AggregatedStats, MoreStats, CostCompleteness } from '@tokenleak/core';
import type { Achievement } from '@tokenleak/renderers';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatTokens, formatCostWithCompleteness, padRight, padLeft, asciiBar } from '../lib/format.js';

const ACHIEVEMENT_ICONS: Record<string, string> = {
  fire: '\u{1F525}',
  star: '\u2B50',
  circle: '\u26AA',
  diamond: '\u{1F48E}',
  bolt: '\u26A1',
  trophy: '\u{1F3C6}',
  target: '\u{1F3AF}',
  mountain: '\u26F0\uFE0F',
  palette: '\u{1F3A8}',
  calendar: '\u{1F4C5}',
  moon: '\u{1F319}',
  sun: '\u2600\uFE0F',
  rocket: '\u{1F680}',
};

const STAT_COL_WIDTH = 24;

/** Center a string within a fixed width */
function centerPad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  const left = Math.floor((width - s.length) / 2);
  const right = width - s.length - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
}

/** Big stat block for wrapped view — fixed-width for grid alignment */
function bigStat(label: string, value: string, valueColor: string) {
  return Box(
    { flexDirection: 'column', width: STAT_COL_WIDTH, alignItems: 'center' },
    Text({ content: centerPad(label, STAT_COL_WIDTH), fg: COLORS.dimWhite }),
    Text({ content: centerPad(value, STAT_COL_WIDTH), fg: valueColor, attributes: BOLD }),
  );
}

export function createWrappedPanel(
  stats: AggregatedStats | null,
  achievements: Achievement[],
  providers: Array<{ displayName: string; totalTokens: number; totalCost: number; costCompleteness?: CostCompleteness }>,
  scrollOffset: number,
  more: MoreStats | null,
) {
  if (!stats) {
    return Box(
      {
        flexDirection: 'column',
        width: '100%',
        flexGrow: 1,
        borderStyle: 'double',
        borderColor: COLORS.amber,
        padding: 1,
      },
      Text({ content: ' YOUR AI WRAPPED ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: 'No data available', fg: COLORS.dimWhite }),
    );
  }

  const totalDays = stats.totalDays || 1;
  const activePct = `${stats.activeDays} / ${totalDays}`;

  // Build all content rows, then slice for scrolling
  const contentRows: ReturnType<typeof Box | typeof Text>[] = [];

  // Stat grid: 3 rows × 3 columns, evenly spaced
  const statRow = (...cells: ReturnType<typeof Box>[]) =>
    Box({ flexDirection: 'row', width: '100%', justifyContent: 'space-evenly' }, ...cells);

  contentRows.push(
    Text({ content: '', fg: COLORS.dimWhite }),
    statRow(
      bigStat('TOTAL TOKENS', formatTokens(stats.totalTokens), COLORS.green),
      bigStat('TOTAL COST', formatCostWithCompleteness(stats.totalCost, stats.costCompleteness), COLORS.amber),
      bigStat('ACTIVE DAYS', activePct, COLORS.cyan),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    statRow(
      bigStat('STREAK', `${stats.currentStreak} days`, COLORS.green),
      bigStat('CACHE HIT', `${(stats.cacheHitRate * 100).toFixed(1)}%`, COLORS.cyan),
      bigStat('AVG DAILY', formatTokens(stats.averageDailyTokens) + ' tok', COLORS.green),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    statRow(
      bigStat('INPUT TOKENS', formatTokens(stats.totalInputTokens), COLORS.green),
      bigStat('OUTPUT TOKENS', formatTokens(stats.totalOutputTokens), COLORS.amber),
      bigStat('PEAK DAY', stats.peakDay ? `${stats.peakDay.date}` : 'N/A', COLORS.cyan),
    ),
  );

  // Achievements section
  if (achievements.length > 0) {
    contentRows.push(
      Text({
        content: '\u2500\u2500\u2500 ACHIEVEMENTS ' + '\u2500'.repeat(40),
        fg: COLORS.amber,
        attributes: BOLD,
      }),
    );

    for (const a of achievements) {
      const icon = ACHIEVEMENT_ICONS[a.icon] ?? '\u2605';
      contentRows.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: `  ${icon} `, fg: COLORS.amber }),
          Text({ content: padRight(a.title, 22), fg: COLORS.green, attributes: BOLD }),
          Text({ content: a.subtitle, fg: COLORS.dimWhite }),
        ),
      );
    }
  }

  // Usage Breakdown section (from MoreStats)
  if (more) {
    contentRows.push(
      Text({
        content: '\u2500\u2500\u2500 USAGE BREAKDOWN ' + '\u2500'.repeat(37),
        fg: COLORS.amber,
        attributes: BOLD,
      }),
    );

    const io = more.inputOutput;
    const ioRatio = io.inputPerOutput !== null ? `${io.inputPerOutput.toFixed(1)}:1` : '-';
    const outputShare = `${(io.outputShare * 100).toFixed(1)}%`;
    const cacheReuse = more.cacheEconomics.reuseRatio !== null
      ? `${more.cacheEconomics.reuseRatio.toFixed(1)}x`
      : '-';

    contentRows.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: '  I/O Ratio: ', fg: COLORS.dimWhite }),
        Text({ content: padRight(ioRatio, 10), fg: COLORS.green }),
        Text({ content: 'Output Share: ', fg: COLORS.dimWhite }),
        Text({ content: padRight(outputShare, 10), fg: COLORS.green }),
        Text({ content: 'Cache Reuse: ', fg: COLORS.dimWhite }),
        Text({ content: cacheReuse, fg: COLORS.cyan }),
      ),
    );

    const burn = more.monthlyBurn;
    const projCost = formatCostWithCompleteness(burn.projectedCost, stats.costCompleteness);
    const dailyRate = burn.observedDays > 0
      ? formatCostWithCompleteness(burn.projectedCost / (burn.calendarDays || 30), stats.costCompleteness)
      : '-';

    contentRows.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: '  Monthly Burn: ', fg: COLORS.dimWhite }),
        Text({ content: `${projCost} projected`, fg: COLORS.amber }),
        Text({ content: '    Burn Rate: ', fg: COLORS.dimWhite }),
        Text({ content: `${dailyRate}/day`, fg: COLORS.amber }),
      ),
    );
  }

  // Top models section
  const models = stats.topModels.slice(0, 5);
  if (models.length > 0) {
    const maxTokens = Math.max(...models.map((m) => m.tokens), 1);

    contentRows.push(
      Text({
        content: '\u2500\u2500\u2500 TOP MODELS ' + '\u2500'.repeat(42),
        fg: COLORS.amber,
        attributes: BOLD,
      }),
    );

    for (let i = 0; i < models.length; i++) {
      const m = models[i]!;
      const ratio = m.tokens / maxTokens;
      const isTop = i === 0;

      contentRows.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: `  ${i + 1}. `, fg: COLORS.dimWhite }),
          Text({
            content: padRight(m.model, 22),
            fg: isTop ? COLORS.amber : COLORS.green,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: asciiBar(ratio, 15), fg: isTop ? COLORS.amber : COLORS.green }),
          Text({ content: `  ${m.percentage.toFixed(1)}%`, fg: COLORS.white }),
          Text({ content: padLeft(formatCostWithCompleteness(m.cost, m.costCompleteness), 10), fg: COLORS.amber }),
        ),
      );
    }
  }

  // Top providers section — expanded to one per line with tokens + cost
  if (providers.length > 0) {
    const totalTokens = providers.reduce((s, p) => s + p.totalTokens, 0) || 1;

    contentRows.push(
      Text({
        content: '\u2500\u2500\u2500 TOP PROVIDERS ' + '\u2500'.repeat(39),
        fg: COLORS.amber,
        attributes: BOLD,
      }),
    );

    for (const p of providers.slice(0, 5)) {
      const pct = ((p.totalTokens / totalTokens) * 100).toFixed(0);
      contentRows.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: `  ${padRight(p.displayName, 16)}`, fg: COLORS.green, attributes: BOLD }),
          Text({ content: padLeft(`${formatTokens(p.totalTokens)} tokens`, 16), fg: COLORS.green }),
          Text({ content: padLeft(formatCostWithCompleteness(p.totalCost, p.costCompleteness), 10), fg: COLORS.amber }),
          Text({ content: padLeft(`${pct}%`, 7), fg: COLORS.white }),
        ),
      );
    }
  }

  // Apply scroll offset
  const visible = contentRows.slice(scrollOffset);

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'double',
      borderColor: COLORS.amber,
      padding: 1,
    },
    Text({ content: '               YOUR AI WRAPPED', fg: COLORS.amber, attributes: BOLD }),
    ...visible,
  );
}
