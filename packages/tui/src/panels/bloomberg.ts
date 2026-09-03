import { Box, Text } from '@opentui/core';
import { getTodayLocal, shiftDateStringLocal } from '@tokenleak/core';
import type { AppState } from '../lib/state.js';
import { WINDOW_DAYS } from '../lib/state.js';
import { COLORS, BOLD } from '../lib/theme.js';
import {
  formatTokens,
  formatCost,
  formatCostCompletenessWarning,
  formatCostWithCompleteness,
  padRight,
  padLeft,
  asciiBar,
  truncate,
  formatPercent,
} from '../lib/format.js';
import { getProviderColor } from '../lib/theme.js';
import { createTimeWindowsPanel } from './time-windows.js';
import { ensureMoreStats, getDayOfWeekForWindow } from '../lib/data.js';

// Page 2 panels
import { createHourOfDayPanel, createDayOfWeekPanel } from './matrix-activity.js';
import { createInputOutputPanel, createMonthlyBurnPanel } from './matrix-io.js';

// Page 3 panels
import { createCacheEconomicsPanel, createCacheRoiPanel } from './matrix-cache.js';
import { createSessionsPanel, createTopProjectsPanel } from './matrix-sessions.js';

// Page 4 panels
import { createModelEfficiencyPanel, createAttributionPanel, createTopSessionsPanel, createCacheRoiByModelPanel } from './matrix-efficiency.js';

const MATRIX_PAGE_COUNT = 4;

/** Stat row helper for overview quadrant */
function statRow(label: string, value: string, valueColor: string = COLORS.green) {
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: label, fg: COLORS.dimWhite }),
    Text({ content: '  ' }),
    Text({ content: value, fg: valueColor, attributes: BOLD }),
  );
}

/** Overview quadrant: aggregated stats for the selected window */
function createOverviewPanel(state: AppState) {
  const stats = state.data?.windows[state.selectedWindowIndex]?.stats ?? null;
  const providers = state.data?.providers ?? [];

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (!stats || (stats.totalTokens === 0 && stats.totalCost === 0)) {
    children.push(
      Text({ content: 'No usage data for this period', fg: COLORS.dimWhite }),
    );
  } else {
    children.push(
      statRow('Total Tokens', formatTokens(stats.totalTokens)),
      statRow(
        'Total Cost',
        formatCostWithCompleteness(stats.totalCost, stats.costCompleteness),
        COLORS.amber,
      ),
      statRow('Active / Total Days', `${stats.activeDays} / ${stats.totalDays}`),
      statRow('Current Streak', `${stats.currentStreak}d`),
      statRow('Longest Streak', `${stats.longestStreak}d`),
      statRow('Cache Hit Rate', formatPercent(stats.cacheHitRate), COLORS.cyan),
      statRow('Avg Daily Tokens', formatTokens(stats.averageDailyTokens)),
      statRow(
        'Avg Daily Cost',
        formatCostWithCompleteness(stats.averageDailyCost, stats.costCompleteness),
        COLORS.amber,
      ),
      statRow('Providers', `${providers.length} active`),
      statRow('Peak Day', stats.peakDay ? `${stats.peakDay.date} (${formatTokens(stats.peakDay.tokens)})` : 'N/A'),
      statRow('Input Tokens', formatTokens(stats.totalInputTokens)),
      statRow('Output Tokens', formatTokens(stats.totalOutputTokens)),
    );
    const warning = formatCostCompletenessWarning(stats.costCompleteness);
    if (warning) {
      children.push(Text({ content: warning, fg: COLORS.red }));
    }
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.amber,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' OVERVIEW ', fg: COLORS.amber, attributes: BOLD }),
    ...children,
  );
}

/** Providers quadrant: uses window-filtered daily data to compute per-provider totals */
function createProvidersPanel(state: AppState) {
  const stats = state.data?.windows[state.selectedWindowIndex]?.stats ?? null;
  const providers = state.data?.providers ?? [];
  const totalTokens = stats?.totalTokens ?? 0;

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (providers.length === 0 || totalTokens === 0) {
    children.push(Text({ content: 'No provider data for this period', fg: COLORS.dimWhite }));
  } else {
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('Provider', 14), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Tokens', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Cost', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Share', 8), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: '  ' }),
        Text({ content: 'Bar', fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(58), fg: COLORS.dimWhite }),
    );

    // Use window stats for providers — filter each provider's daily data
    const days = WINDOW_DAYS[state.selectedWindowIndex];
    const providerTotals = providers.map((p) => {
      let provTokens = p.totalTokens;
      let provCost = p.totalCost;

      if (days && days > 0 && p.daily) {
        const todayStr = getTodayLocal();
        const sinceStr = shiftDateStringLocal(todayStr, -(days - 1));
        const filtered = p.daily.filter((d) => d.date >= sinceStr && d.date <= todayStr);
        provTokens = filtered.reduce((s, d) => s + d.totalTokens, 0);
        provCost = filtered.reduce((s, d) => s + d.cost, 0);
      }

      return { ...p, windowTokens: provTokens, windowCost: provCost };
    });

    const sorted = providerTotals
      .filter((p) => p.windowTokens > 0)
      .sort((a, b) => b.windowTokens - a.windowTokens);

    if (sorted.length === 0) {
      children.push(Text({ content: 'No provider data for this period', fg: COLORS.dimWhite }));
    } else {
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i]!;
        const share = totalTokens > 0 ? p.windowTokens / totalTokens : 0;
        const color = getProviderColor(p.provider, i);

        children.push(
          Box(
            { flexDirection: 'row', width: '100%' },
            Text({ content: padRight(p.displayName, 14), fg: color, attributes: BOLD }),
            Text({ content: padLeft(formatTokens(p.windowTokens), 10), fg: COLORS.green }),
            Text({ content: padLeft(formatCost(p.windowCost), 10), fg: COLORS.amber }),
            Text({
              content: padLeft(`${(share * 100).toFixed(1)}%`, 8),
              fg: COLORS.white,
            }),
            Text({ content: ' ' }),
            Text({ content: asciiBar(share, 10), fg: color }),
          ),
        );
      }
    }
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.green,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' PROVIDERS ', fg: COLORS.green, attributes: BOLD }),
    ...children,
  );
}

/** Top models quadrant */
function createTopModelsPanel(state: AppState) {
  const stats = state.data?.windows[state.selectedWindowIndex]?.stats ?? null;
  const models = stats?.topModels ?? [];

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (models.length === 0) {
    children.push(Text({ content: 'No model data for this period', fg: COLORS.dimWhite }));
  } else {
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('#', 3), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padRight('Model', 28), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Tokens', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Cost', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Share', 8), fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(59), fg: COLORS.dimWhite }),
    );

    const top10 = models.slice(0, 10);
    for (let i = 0; i < top10.length; i++) {
      const m = top10[i]!;
      const isTop = i === 0;
      const nameColor = isTop ? COLORS.amber : COLORS.green;

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: padRight(`${i + 1}.`, 3), fg: COLORS.dimWhite }),
          Text({
            content: padRight(truncate(m.model, 27), 28),
            fg: nameColor,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: padLeft(formatTokens(m.tokens), 10), fg: COLORS.green }),
          Text({ content: padLeft(formatCostWithCompleteness(m.cost, m.costCompleteness), 10), fg: COLORS.amber }),
          Text({
            content: padLeft(`${m.percentage.toFixed(1)}%`, 8),
            fg: COLORS.white,
          }),
        ),
      );
    }
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.magenta,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' TOP MODELS ', fg: COLORS.magenta, attributes: BOLD }),
    ...children,
  );
}

/** Page indicator at the bottom of matrix view */
function createPageIndicator(page: number) {
  const dots = Array.from({ length: MATRIX_PAGE_COUNT }, (_, i) =>
    i === page ? '\u25CF' : '\u25CB',
  ).join(' ');

  return Box(
    { flexDirection: 'row', width: '100%', justifyContent: 'center', height: 1 },
    Text({ content: `Page ${page + 1}/${MATRIX_PAGE_COUNT}  ${dots}  `, fg: COLORS.dimWhite }),
    Text({ content: '[', fg: COLORS.amber }),
    Text({ content: ':prev  ', fg: COLORS.dimWhite }),
    Text({ content: ']', fg: COLORS.amber }),
    Text({ content: ':next', fg: COLORS.dimWhite }),
  );
}

/** Page 1: Overview + Time Windows + Providers + Top Models (existing layout) */
function createPage0(state: AppState) {
  const windows = state.data?.windows ?? [];
  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1 },
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createOverviewPanel(state),
      createTimeWindowsPanel({ windows }),
    ),
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createProvidersPanel(state),
      createTopModelsPanel(state),
    ),
  );
}

/** Page 2: Activity Patterns (Hour of Day + Day of Week + I/O + Monthly Burn) */
function createPage1(state: AppState) {
  const more = ensureMoreStats(state);
  const dowData = getDayOfWeekForWindow(state);

  if (!more) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, padding: 2 },
      Text({ content: 'No extended stats available for this period', fg: COLORS.dimWhite }),
    );
  }

  const stats = state.data?.windows[state.selectedWindowIndex]?.stats;

  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1 },
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createHourOfDayPanel(more.hourOfDay),
      createDayOfWeekPanel(dowData),
    ),
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createInputOutputPanel(more.inputOutput, {
        totalInputTokens: stats?.totalInputTokens ?? 0,
        totalOutputTokens: stats?.totalOutputTokens ?? 0,
      }),
      createMonthlyBurnPanel(more.monthlyBurn),
    ),
  );
}

/** Page 3: Cache & Sessions */
function createPage2(state: AppState) {
  const more = ensureMoreStats(state);

  if (!more) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, padding: 2 },
      Text({ content: 'No extended stats available for this period', fg: COLORS.dimWhite }),
    );
  }

  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1 },
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createCacheEconomicsPanel(more.cacheEconomics),
      createCacheRoiPanel(more.cacheRoi),
    ),
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createSessionsPanel(more.sessionMetrics),
      createTopProjectsPanel(more.projectDrilldown),
    ),
  );
}

/** Page 4: Efficiency & Attribution */
function createPage3(state: AppState) {
  const more = ensureMoreStats(state);

  if (!more) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, padding: 2 },
      Text({ content: 'No extended stats available for this period', fg: COLORS.dimWhite }),
    );
  }

  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1 },
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createModelEfficiencyPanel(more.modelEfficiency),
      createAttributionPanel(more.attribution),
    ),
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createTopSessionsPanel(more.sessionDrilldown),
      createCacheRoiByModelPanel(more.cacheRoi),
    ),
  );
}

export function createMatrixView(state: AppState) {
  const page = state.matrixPage;
  let pageContent: ReturnType<typeof Box>;

  switch (page) {
    case 0: pageContent = createPage0(state); break;
    case 1: pageContent = createPage1(state); break;
    case 2: pageContent = createPage2(state); break;
    case 3: pageContent = createPage3(state); break;
    default: pageContent = createPage0(state); break;
  }

  return Box(
    { flexDirection: 'column', width: '100%', height: '100%', flexGrow: 1 },
    pageContent,
    createPageIndicator(page),
  );
}
