import type { RenderOptions, TokenleakOutput } from '@tokenleak/core';
import { colorize } from './ansi';
import type {
  DashboardModel,
  MetricEntry,
  PatternEntry,
  ProviderDashboardModel,
} from './dashboard-model';
import {
  buildDashboardModel,
  formatCost,
  formatTokens,
} from './dashboard-model';
import { renderTerminalHeatmap } from './heatmap';
import { clampVisible, padVisible, renderColumns, visibleLength } from './layout';

const BOX_H = '\u2500';
const BOX_V = '\u2502';
const BOX_TL = '\u250C';
const BOX_TR = '\u2510';
const BOX_BL = '\u2514';
const BOX_BR = '\u2518';
const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';

function divider(width: number): string {
  return BOX_H.repeat(width);
}

function boxedHeader(title: string, width: number, noColor: boolean): string {
  const inner = Math.max(1, width - 2);
  const padded = ` ${title} `;
  const remaining = Math.max(0, inner - padded.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  const titleLine = `${BOX_V}${' '.repeat(left)}${colorize(padded, 'bold', noColor)}${' '.repeat(right)}${BOX_V}`;

  return [
    `${BOX_TL}${BOX_H.repeat(inner)}${BOX_TR}`,
    titleLine,
    `${BOX_BL}${BOX_H.repeat(inner)}${BOX_BR}`,
  ].join('\n');
}

function renderSectionTitle(title: string, noColor: boolean): string {
  return colorize(`  ${title}`, 'bold', noColor);
}

function renderSummary(parts: string[], width: number, noColor: boolean): string[] {
  if (parts.length === 0) return [];

  const colored = parts.map((part, index) => colorize(part, index % 2 === 0 ? 'cyan' : 'green', noColor));
  const line = colored.join(colorize('  |  ', 'dim', noColor));
  return [clampVisible(`  ${line}`, width)];
}

function renderTrend(trend: string, width: number, noColor: boolean): string[] {
  if (!trend) return [];
  return [
    clampVisible(`  ${colorize('Recent Trend', 'bold', noColor)}  ${colorize(trend, 'green', noColor)}`, width),
  ];
}

function renderMetricLine(entry: MetricEntry, width: number, noColor: boolean): string {
  const label = entry.label;
  const value = colorize(entry.value, 'cyan', noColor);
  const gutter = 2;
  const safeWidth = Math.max(12, width);
  const valueWidth = Math.min(Math.max(6, visibleLength(entry.value)), Math.max(6, Math.floor(safeWidth * 0.45)));
  const labelWidth = Math.max(4, safeWidth - valueWidth - gutter);
  return `${clampVisible(label, labelWidth)}${' '.repeat(gutter)}${padVisible(value, valueWidth)}`;
}

function renderMetrics(entries: MetricEntry[], width: number, noColor: boolean): string[] {
  if (entries.length === 0) return [];
  const innerWidth = Math.max(16, width - 2);

  if (width >= 86 && entries.length > 3) {
    const midpoint = Math.ceil(entries.length / 2);
    const left = entries.slice(0, midpoint).map((entry) => `  ${renderMetricLine(entry, Math.floor((innerWidth - 3) / 2), noColor)}`);
    const right = entries.slice(midpoint).map((entry) => `  ${renderMetricLine(entry, Math.floor((innerWidth - 3) / 2), noColor)}`);
    return renderColumns(left, right, innerWidth, 0.5, 3);
  }

  return entries.map((entry) => `  ${renderMetricLine(entry, innerWidth, noColor)}`);
}

function renderPatternList(
  title: string,
  entries: PatternEntry[],
  width: number,
  noColor: boolean,
): string[] {
  if (entries.length === 0) return [];

  const lines = [renderSectionTitle(title, noColor)];
  const innerWidth = Math.max(18, width - 2);
  const nameWidth = Math.min(22, Math.max(8, Math.floor(innerWidth * 0.35)));
  const valueWidth = 6;
  const barWidth = Math.max(6, innerWidth - nameWidth - valueWidth - 6);

  for (const entry of entries) {
    const fillLength = Math.max(1, Math.round(entry.share * barWidth));
    const fill = colorize(BAR_CHAR.repeat(fillLength), 'green', noColor);
    const track = TRACK_CHAR.repeat(Math.max(0, barWidth - fillLength));
    const line = `  ${colorize(clampVisible(entry.label, nameWidth).padEnd(nameWidth), 'yellow', noColor)}  ${fill}${track}  ${entry.value.padStart(valueWidth)}`;
    lines.push(clampVisible(line, width));
  }

  return lines;
}

function renderPatternColumns(provider: ProviderDashboardModel, width: number, noColor: boolean): string[] {
  const dayLines = renderPatternList('Day of Week', provider.dayOfWeek, Math.floor((width - 3) / 2), noColor);
  const modelLines = renderPatternList('Top Models', provider.topModels, Math.floor((width - 3) / 2), noColor);

  if (dayLines.length > 0 && modelLines.length > 0 && width >= 96) {
    return renderColumns(dayLines, modelLines, width - 2, 0.5, 3).map((line) => `  ${line}`);
  }

  return [...dayLines, ...(dayLines.length > 0 && modelLines.length > 0 ? [''] : []), ...modelLines];
}

function renderInsights(insights: string[], width: number, noColor: boolean): string[] {
  if (insights.length === 0) return [];
  return [
    renderSectionTitle('Insights', noColor),
    ...insights.map((insight) => clampVisible(`  ${colorize('*', 'green', noColor)} ${insight}`, width)),
  ];
}

function renderProviderSection(provider: ProviderDashboardModel, width: number, noColor: boolean): string {
  const sections: string[] = [
    boxedHeader(provider.provider.displayName, width, noColor),
    ...renderSummary(provider.summary, width, noColor),
    ...renderTrend(provider.trend, width, noColor),
    '',
    renderSectionTitle('Heatmap', noColor),
    renderTerminalHeatmap(provider.provider.daily, { width: width - 2, noColor }),
    '',
    renderSectionTitle('Stats', noColor),
    ...renderMetrics(provider.metrics, width, noColor),
  ];

  const patternLines = renderPatternColumns(provider, width, noColor);
  if (patternLines.length > 0) {
    sections.push('', ...patternLines);
  }

  const insightLines = renderInsights(provider.insights, width, noColor);
  if (insightLines.length > 0) {
    sections.push('', ...insightLines);
  }

  return sections.join('\n');
}

function renderOverview(model: DashboardModel, width: number, noColor: boolean): string {
  const sections: string[] = [
    boxedHeader('Overview', width, noColor),
    ...renderSummary(model.overview.summary, width, noColor),
    ...renderTrend(model.overview.trend, width, noColor),
    '',
    ...renderMetrics(model.overview.metrics, width, noColor),
  ];

  if (model.overview.providerLeaders.length > 1) {
    sections.push('', ...renderPatternList('Provider Mix', model.overview.providerLeaders, width, noColor));
  }

  return sections.join('\n');
}

export function renderDashboardModel(model: DashboardModel, options: RenderOptions): string {
  const width = options.width;
  const noColor = options.noColor;
  const sections: string[] = [
    boxedHeader('Tokenleak', width, noColor),
    ...renderSummary([model.rangeLabel, ...model.overview.summary], width, noColor),
  ];

  if (model.activeProviders.length === 0) {
    sections.push('');
    sections.push('  No provider activity in the selected range.');
    if (model.inactiveProviders.length > 0) {
      sections.push(clampVisible(`  Checked: ${model.inactiveProviders.join(', ')}`, width));
    }
    return sections.join('\n');
  }

  sections.push('', renderOverview(model, width, noColor));

  for (const provider of model.activeProviders) {
    const providerSection = options.showInsights
      ? renderProviderSection(provider, width, noColor)
      : renderProviderSection({ ...provider, insights: [] }, width, noColor);
    sections.push('', divider(width), '', providerSection);
  }

  if (model.inactiveProviders.length > 0) {
    sections.push('');
    sections.push(clampVisible(`  No activity in range: ${model.inactiveProviders.join(', ')}`, width));
  }

  return sections.join('\n');
}

export function renderDashboard(output: TokenleakOutput, options: RenderOptions): string {
  return renderDashboardModel(buildDashboardModel(output, options), options);
}

export { formatCost, formatTokens };
