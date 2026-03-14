import type { RenderOptions } from '@tokenleak/core';
import { colorize } from './ansi';
import type { DashboardModel } from './dashboard-model';
import { renderColumns, truncateVisible } from './layout';

const BOX_H = '\u2500';
const BOX_V = '\u2502';
const BOX_TL = '\u250C';
const BOX_TR = '\u2510';
const BOX_BL = '\u2514';
const BOX_BR = '\u2518';

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

function renderSummaryParts(parts: string[], width: number, noColor: boolean): string {
  const left = parts.filter((_, index) => index % 2 === 0).map((part) => colorize(part, 'cyan', noColor));
  const right = parts.filter((_, index) => index % 2 === 1).map((part) => colorize(part, 'green', noColor));
  return renderColumns(left, right, Math.max(24, width - 2), 0.5, 2)
    .map((line) => `  ${line}`)
    .join('\n');
}

export function renderCompactDashboard(model: DashboardModel, options: RenderOptions): string {
  const width = options.width;
  const noColor = options.noColor;
  const lines = [
    boxedHeader('Tokenleak', width, noColor),
    '',
    truncateVisible(`  Range ${model.rangeLabel}`, width),
    '',
    renderSummaryParts(model.overview.summary, width, noColor),
    ...(model.overview.trend
      ? ['', truncateVisible(`  Recent Trend ${model.overview.trend}`, width)]
      : []),
    '',
  ];

  if (model.overview.metrics.length > 0) {
    const keyMetrics = model.overview.metrics.slice(0, 4).map((metric) => {
      const text = `${metric.label}: ${metric.value}`;
      return `  ${truncateVisible(text, width - 2)}`;
    });
    lines.push(...keyMetrics, '');
  }

  if (model.activeProviders.length > 0) {
    lines.push(colorize('  Providers', 'bold', noColor));
    for (const provider of model.activeProviders.slice(0, 4)) {
      const tokensMetric = provider.metrics.find((entry) => entry.label === 'Total Tokens');
      const summary = `${provider.provider.displayName} ${tokensMetric?.value ?? ''} ${provider.lastActiveDate ? `| ${provider.lastActiveDate}` : ''}`.trim();
      lines.push(truncateVisible(`  ${summary}`, width));
    }
    lines.push('');
  }

  if (model.inactiveProviders.length > 0) {
    lines.push(truncateVisible(`  No activity: ${model.inactiveProviders.join(', ')}`, width));
  } else if (model.activeProviders.length === 0) {
    lines.push('  No provider activity in the selected range.');
  }

  return lines
    .filter((line, index, array) => !(line === '' && array[index - 1] === ''))
    .join('\n');
}
