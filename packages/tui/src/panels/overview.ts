import { Box, StyledText, Text, bg, fg } from '@opentui/core';
import type { TextChunk } from '@opentui/core';
import type { SavingsRecommendation } from '@tokenleak/core';
import { formatCost, formatShortDate, formatTokens, padLeft, padRight, truncate } from '../lib/format.js';
import type { Kpi, OverviewData, OverviewMetric, ShareRow, StackedSeries } from '../lib/overview-model.js';
import { OTHER_MODELS, buildKpis, buildOverviewData, topRecommendation } from '../lib/overview-model.js';
import { chartRows, layoutColumns } from '../lib/stacked-chart.js';
import type { ChartCell } from '../lib/stacked-chart.js';
import type { AppState } from '../lib/state.js';
import { BOLD, COLORS, MODEL_COLORS, getProviderColor, rgba } from '../lib/theme.js';
import { WINDOW_LABELS } from '../lib/state.js';

/** Rows a KPI tile takes: border, value, note, border. */
const TILE_ROWS = 4;
/** Rows for the savings line under the tables. */
const SAVINGS_ROWS = 1;
/** Chart chrome: border (2), legend (1), axis rule and date labels (2). */
const CHART_CHROME_ROWS = 5;
const MIN_PLOT_ROWS = 3;
const MAX_PLOT_ROWS = 40;
/** Tables always show at least this many rows when the chart could take them. */
const MIN_TABLE_ROWS = 4;
/** Y-axis labels plus the axis line. */
const Y_AXIS_WIDTH = 9;
/** Below this many columns the two tables stack instead of sitting side by side. */
const SIDE_BY_SIDE_MIN_WIDTH = 110;
/** Table chrome: border (2) and title row (1) and header row (1). */
const TABLE_CHROME_ROWS = 4;
/** Border and horizontal padding around panel content. */
const PANEL_CHROME_COLS = 4;
const SHARE_BAR_WIDTH = 12;
const VALUE_WIDTH = 9;
const PERCENT_WIDTH = 6;
const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const;
const LEGEND_NAME_WIDTH = 24;
const LEGEND_GAP = '   ';
/** Swatch and space before each legend name. */
const LEGEND_SWATCH_WIDTH = 2;
/** Room kept for a trailing "+N more". */
const LEGEND_MORE_WIDTH = '+9 more'.length;

export interface OverviewLayout {
  plotRows: number;
  tableRows: number;
  sideBySide: boolean;
}

/**
 * Splits the view's rows between tiles, chart, tables and the savings line.
 * Tables get the rows their longest list needs (at least
 * {@link MIN_TABLE_ROWS}); the chart takes what is left, up to
 * {@link MAX_PLOT_ROWS}, and any remainder goes back to the tables.
 */
export function overviewLayout(width: number, height: number, longestTable = Number.POSITIVE_INFINITY): OverviewLayout {
  const sideBySide = width >= SIDE_BY_SIDE_MIN_WIDTH;
  const tableStacks = sideBySide ? 1 : 2;
  const rest = Math.max(0, height - TILE_ROWS - SAVINGS_ROWS - CHART_CHROME_ROWS - tableStacks * TABLE_CHROME_ROWS);
  const wantedTableRows = Math.max(MIN_TABLE_ROWS, Math.min(longestTable, rest));
  const plotRows = Math.max(MIN_PLOT_ROWS, Math.min(MAX_PLOT_ROWS, rest - wantedTableRows * tableStacks));
  const tableRows = Math.max(1, Math.floor((rest - plotRows) / tableStacks));
  return { plotRows, tableRows, sideBySide };
}

/** Rows of a share table that list entries; the "more" line takes one when the list does not fit. */
export function tableListRows(entries: number, visibleRows: number): number {
  return entries > visibleRows ? Math.max(1, visibleRows - 1) : visibleRows;
}

/** The legend names that fit on one line of `width` cells, leaving room for "+N more". */
export function fitLegend(names: readonly string[], width: number): { shown: string[]; hidden: number } {
  const shown: string[] = [];
  let used = 0;
  for (const [index, name] of names.entries()) {
    const cost = LEGEND_SWATCH_WIDTH + name.length + LEGEND_GAP.length;
    const reserve = index < names.length - 1 ? LEGEND_MORE_WIDTH : 0;
    if (used + cost + reserve > width && shown.length > 0) break;
    shown.push(name);
    used += cost;
  }
  return { shown, hidden: names.length - shown.length };
}

/** A share bar `width` cells wide, exact to an eighth of a cell. */
export function shareBar(share: number, width: number): string {
  const eighths = Math.round(Math.max(0, Math.min(1, share)) * width * 8);
  const full = Math.floor(eighths / 8);
  return `${'█'.repeat(full)}${PARTIAL_BLOCKS[eighths % 8]}`.padEnd(width);
}

function changeText(kpi: Kpi): { text: string; color: string } {
  if (kpi.change === null) return { text: kpi.note ?? '', color: COLORS.dimWhite };
  const arrow = kpi.change > 0 ? '▲' : kpi.change < 0 ? '▼' : '■';
  const text = `${arrow} ${Math.abs(kpi.change * 100).toFixed(1)}%`;
  if (kpi.change === 0 || kpi.direction === 'neutral') return { text, color: COLORS.cyan };
  const good = kpi.direction === 'up-good' ? kpi.change > 0 : kpi.change < 0;
  return { text, color: good ? COLORS.green : COLORS.red };
}

const KPI_VALUE_COLORS: Record<string, string> = {
  Spend: COLORS.amber,
  Tokens: COLORS.green,
  'Cache hit': COLORS.cyan,
  Active: COLORS.white,
  'Peak day': COLORS.magenta,
};

function kpiTile(kpi: Kpi, comparison: string, innerWidth: number) {
  const change = changeText(kpi);
  const withComparison = `${change.text} ${comparison}`;
  const detail = kpi.change === null || withComparison.length > innerWidth ? change.text : withComparison;
  return Box(
    {
      flexDirection: 'column',
      flexGrow: 1,
      flexBasis: 0,
      border: true,
      borderStyle: 'rounded',
      borderColor: COLORS.border,
      title: ` ${kpi.label} `,
      paddingLeft: 1,
      paddingRight: 1,
      height: TILE_ROWS,
    },
    Text({
      content: truncate(kpi.value, innerWidth),
      fg: KPI_VALUE_COLORS[kpi.label] ?? COLORS.white,
      attributes: BOLD,
      wrapMode: 'none',
      flexShrink: 0,
    }),
    Text({ content: truncate(detail, innerWidth), fg: change.color, wrapMode: 'none', flexShrink: 0 }),
  );
}

function seriesColor(series: StackedSeries, index: number | null): string | null {
  if (index === null) return null;
  return series.models[index] === OTHER_MODELS ? COLORS.muted : MODEL_COLORS[index % MODEL_COLORS.length]!;
}

function styledRow(cells: ChartCell[], series: StackedSeries): StyledText {
  const chunks: TextChunk[] = [];
  let run = '';
  let runFg: string | null = null;
  let runBg: string | null = null;
  const flush = () => {
    if (!run) return;
    let chunk: TextChunk = runFg ? fg(rgba(runFg))(run) : fg(rgba(COLORS.dimWhite))(run);
    if (runBg) chunk = bg(rgba(runBg))(chunk);
    chunks.push(chunk);
    run = '';
  };
  for (const cell of cells) {
    const cellFg = seriesColor(series, cell.fg);
    const cellBg = seriesColor(series, cell.bg);
    if (cellFg !== runFg || cellBg !== runBg) {
      flush();
      runFg = cellFg;
      runBg = cellBg;
    }
    run += cell.char;
  }
  flush();
  return new StyledText(chunks);
}

function axisValue(value: number, metric: OverviewMetric): string {
  return metric === 'cost' ? formatCost(value) : formatTokens(value);
}

function dateLabels(dates: string[], width: number): string {
  if (dates.length === 0) return '';
  const first = formatShortDate(dates[0]!);
  const last = formatShortDate(dates.at(-1)!);
  if (dates.length === 1) return first;
  const middle = formatShortDate(dates[Math.floor(dates.length / 2)]!);
  const gap = Math.max(1, Math.floor((width - first.length - middle.length - last.length) / 2));
  const line = `${first}${' '.repeat(gap)}${middle}${' '.repeat(gap)}${last}`;
  return line.length <= width ? line : `${first}${' '.repeat(Math.max(1, width - first.length - last.length))}${last}`;
}

function chartPanel(overview: OverviewData, metric: OverviewMetric, width: number, plotRows: number) {
  const series = overview.series;
  const plotWidth = Math.max(10, width - PANEL_CHROME_COLS - Y_AXIS_WIDTH);
  const title = ` ${metric === 'cost' ? 'Spend' : 'Tokens'} per day by model `;
  const box = (...children: ReturnType<typeof Text>[]) =>
    Box(
      {
        flexDirection: 'column',
        width: '100%',
        border: true,
        borderStyle: 'rounded',
        borderColor: COLORS.border,
        title,
        paddingLeft: 1,
        paddingRight: 1,
        height: plotRows + CHART_CHROME_ROWS,
      },
      ...children,
    );

  if (series.max <= 0) {
    return box(Text({ content: 'No usage in this window yet.', fg: COLORS.dimWhite }));
  }

  const layout = layoutColumns(series, plotWidth);
  const rows = chartRows(layout, series.max, plotRows);
  const drawnWidth = rows[0]?.length ?? 0;
  const labelAt = (row: number) => {
    if (row === 0) return axisValue(series.max, metric);
    if (row === Math.floor(plotRows / 2) && plotRows >= 5) return axisValue(series.max / 2, metric);
    return '';
  };
  const lines = rows.map((cells, row) =>
    Text({
      wrapMode: 'none',
      content: new StyledText([
        fg(rgba(COLORS.dimWhite))(`${padLeft(labelAt(row), Y_AXIS_WIDTH - 2)} │`),
        ...styledRow(cells, series).chunks,
      ]),
    }),
  );
  const legendItems = fitLegend(series.models.map((model) => truncate(model, LEGEND_NAME_WIDTH)), width - PANEL_CHROME_COLS);
  const legend = new StyledText([
    ...legendItems.shown.flatMap((model, index) => [
      fg(rgba(seriesColor(series, index)!))('■ '),
      fg(rgba(COLORS.white))(`${model}${LEGEND_GAP}`),
    ]),
    ...(legendItems.hidden > 0 ? [fg(rgba(COLORS.dimWhite))(`+${legendItems.hidden} more`)] : []),
  ]);
  return box(
    ...lines,
    Text({ content: `${' '.repeat(Y_AXIS_WIDTH - 1)}└${'─'.repeat(drawnWidth)}`, fg: COLORS.border }),
    Text({
      content: `${' '.repeat(Y_AXIS_WIDTH)}${dateLabels(layout.columns.map((column) => column.date), drawnWidth)}`,
      fg: COLORS.dimWhite,
    }),
    Text({ content: legend, wrapMode: 'none' }),
  );
}

function shareTable(
  title: string,
  rows: ShareRow[],
  metric: OverviewMetric,
  width: number,
  visibleRows: number,
  offset: number,
  colorOf: (row: ShareRow, index: number) => string,
) {
  const inner = Math.max(20, width - PANEL_CHROME_COLS);
  const nameWidth = Math.max(8, inner - 2 - SHARE_BAR_WIDTH - 1 - PERCENT_WIDTH - VALUE_WIDTH * 2);
  const listRows = tableListRows(rows.length, visibleRows);
  const start = Math.max(0, Math.min(offset, rows.length - listRows));
  const visible = rows.slice(start, start + listRows);
  const hidden = rows.length - start - visible.length;
  const header = `  ${padRight('', nameWidth)}${padRight(`share by ${metric}`, SHARE_BAR_WIDTH + 1)}${padLeft('', PERCENT_WIDTH)}${padLeft('cost', VALUE_WIDTH)}${padLeft('tokens', VALUE_WIDTH)}`;
  return Box(
    {
      flexDirection: 'column',
      flexGrow: 1,
      flexBasis: 0,
      border: true,
      borderStyle: 'rounded',
      borderColor: COLORS.border,
      title: ` ${title} `,
      paddingLeft: 1,
      paddingRight: 1,
      overflow: 'hidden',
    },
    Text({ content: header, fg: COLORS.dimWhite, wrapMode: 'none', flexShrink: 0 }),
    ...(visible.length === 0 ? [Text({ content: '  No usage in this window.', fg: COLORS.dimWhite })] : []),
    ...visible.map((row, index) => {
      const color = colorOf(row, start + index);
      return Text({
        wrapMode: 'none',
        flexShrink: 0,
        content: new StyledText([
          fg(rgba(color))('● '),
          fg(rgba(COLORS.white))(padRight(truncate(row.label, nameWidth - 1), nameWidth)),
          fg(rgba(color))(shareBar(row.share, SHARE_BAR_WIDTH)),
          fg(rgba(COLORS.dimWhite))(` ${padLeft(`${(row.share * 100).toFixed(1)}%`, PERCENT_WIDTH)}`),
          fg(rgba(COLORS.amber))(padLeft(formatCost(row.cost), VALUE_WIDTH)),
          fg(rgba(COLORS.green))(padLeft(formatTokens(row.tokens), VALUE_WIDTH)),
        ]),
      });
    }),
    ...(hidden > 0 || start > 0
      ? [
          Text({
            content: `  ${start > 0 ? `▲ ${start} above  ` : ''}${hidden > 0 ? `▼ ${hidden} more` : ''}  (j/k)`,
            fg: COLORS.dimWhite,
            wrapMode: 'none',
            flexShrink: 0,
          }),
        ]
      : []),
  );
}

function savingsLine(recommendation: SavingsRecommendation | null, pending: boolean) {
  if (!recommendation) {
    return Text({
      content: pending ? '  Looking for savings in this window…' : '  No savings opportunities found in this window.',
      fg: COLORS.dimWhite,
    });
  }
  const monthly = recommendation.monthlySavings;
  return Text({
    content: new StyledText([
      fg(rgba(COLORS.green))('  ◆ Top saving  '),
      fg(rgba(COLORS.white))(recommendation.title),
      fg(rgba(COLORS.amber))(monthly !== null ? `  ~${formatCost(monthly)}/mo` : ''),
      fg(rgba(COLORS.dimWhite))('   press 4 for the advisor'),
    ]),
  });
}

function placeholder(message: string) {
  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1, paddingLeft: 2, paddingTop: 1 },
    Text({ content: message, fg: COLORS.dimWhite }),
  );
}

/**
 * The home dashboard: headline tiles with change against the previous period,
 * a spend (or token) chart stacked by model, provider and model share tables,
 * and the single most valuable savings opportunity.
 */
export function createOverview(state: AppState, width: number, height: number, savingsPending: boolean) {
  if (!state.data) return placeholder(state.isLoading ? 'Loading usage data…' : 'No usage data found.');
  const metric: OverviewMetric = state.sortMode;
  const overview = buildOverviewData(state.data, state.selectedWindowIndex, metric);
  if (!overview) return placeholder('No usage data found for any provider yet.');

  const windowLabel = WINDOW_LABELS[state.selectedWindowIndex] ?? '';
  const streak = state.data.windows[state.selectedWindowIndex]?.stats.currentStreak ?? 0;
  const kpis = buildKpis(overview, windowLabel, streak);
  const layout = overviewLayout(width, height, Math.max(overview.providers.length, overview.models.length));
  // Side-by-side tables share the width minus the one-cell gap between them.
  const tableWidth = layout.sideBySide ? Math.floor((width - 1) / 2) : width;
  const tileInnerWidth = Math.max(8, Math.floor((width - (kpis.length - 1)) / kpis.length) - PANEL_CHROME_COLS);
  const providerIndex = new Map(state.data.providers.map((provider, index) => [provider.provider, index]));

  const tables = [
    shareTable('Providers', overview.providers, metric, tableWidth, layout.tableRows, 0, (row) =>
      getProviderColor(row.key, providerIndex.get(row.key) ?? 0),
    ),
    shareTable('Models', overview.models, metric, tableWidth, layout.tableRows, state.modelScrollOffset, (_row, index) =>
      MODEL_COLORS[index % MODEL_COLORS.length]!,
    ),
  ];

  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1 },
    Box(
      { flexDirection: 'row', width: '100%', height: TILE_ROWS, gap: 1 },
      ...kpis.map((kpi) => kpiTile(kpi, `vs prior ${windowLabel}`, tileInnerWidth)),
    ),
    chartPanel(overview, metric, width, layout.plotRows),
    Box({ flexDirection: layout.sideBySide ? 'row' : 'column', width: '100%', flexGrow: 1, gap: layout.sideBySide ? 1 : 0 }, ...tables),
    savingsLine(topRecommendation(state.cachedSavingsReport), savingsPending),
  );
}
