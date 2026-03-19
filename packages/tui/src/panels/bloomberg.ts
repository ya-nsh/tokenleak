import { Box, Text } from '@opentui/core';
import type { AppState } from '../lib/state.js';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatTokens, formatCost, padRight, padLeft, asciiBar, truncate, formatPercent } from '../lib/format.js';
import { getProviderColor } from '../lib/theme.js';
import { createTimeWindowsPanel } from './time-windows.js';

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
      statRow('Total Cost', formatCost(stats.totalCost), COLORS.amber),
      statRow('Active / Total Days', `${stats.activeDays} / ${stats.totalDays}`),
      statRow('Current Streak', `${stats.currentStreak}d`),
      statRow('Longest Streak', `${stats.longestStreak}d`),
      statRow('Cache Hit Rate', formatPercent(stats.cacheHitRate), COLORS.cyan),
      statRow('Avg Daily Tokens', formatTokens(stats.averageDailyTokens)),
      statRow('Avg Daily Cost', formatCost(stats.averageDailyCost), COLORS.amber),
      statRow('Providers', `${providers.length} active`),
      statRow('Peak Day', stats.peakDay ? `${stats.peakDay.date} (${formatTokens(stats.peakDay.tokens)})` : 'N/A'),
      statRow('Input Tokens', formatTokens(stats.totalInputTokens)),
      statRow('Output Tokens', formatTokens(stats.totalOutputTokens)),
    );
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
    const providerTotals = providers.map((p) => {
      const windowDays = [7, 30, 90, 0] as const;
      const days = windowDays[state.selectedWindowIndex];
      let provTokens = p.totalTokens;
      let provCost = p.totalCost;

      if (days && days > 0 && p.daily) {
        const now = new Date();
        const since = new Date(now);
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().slice(0, 10);
        const todayStr = now.toISOString().slice(0, 10);
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
          Text({ content: padLeft(formatCost(m.cost), 10), fg: COLORS.amber }),
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

export function createMatrixView(state: AppState) {
  const windows = state.data?.windows ?? [];

  return Box(
    { flexDirection: 'column', width: '100%', height: '100%', flexGrow: 1 },

    // Top row: Overview + Time Windows
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createOverviewPanel(state),
      createTimeWindowsPanel({ windows }),
    ),

    // Bottom row: Providers + Top Models
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createProvidersPanel(state),
      createTopModelsPanel(state),
    ),
  );
}
