import { formatCostWithCompleteness, formatModelWithTier } from '@tokenleak/core';
import type { ModelEfficiencyEntry, TokenleakOutput } from '@tokenleak/core';
import { colorize256, bold, dim, MODEL_COLORS, SEMANTIC } from '../colors';
import { truncateVisible } from '../layout';
import { renderCacheRoiBreakdowns } from './cache-roi';

const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCompactCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  return `$${cost.toFixed(2)}`;
}

function formatRatio(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

interface ModelEfficiencySectionOptions {
  title?: string;
  limit?: number;
  includeMethod?: boolean;
  includeIneligible?: boolean;
}

function renderEfficiencyRow(
  entry: ModelEfficiencyEntry,
  width: number,
  noColor: boolean,
): string {
  const nameWidth = Math.min(24, Math.max(12, width - 43));
  const name = entry.model.length > nameWidth
    ? `${entry.model.slice(0, nameWidth - 1)}…`
    : entry.model.padEnd(nameWidth);

  return truncateVisible(
    `  ${colorize256(name, SEMANTIC.ACCENT, noColor)} ` +
    `${bold(`${(entry.score * 100).toFixed(0)}`.padStart(5), noColor)} ` +
    `${formatTokens(entry.outputPerDollar).padStart(7)} ` +
    `${formatRatio(entry.outputInputRatio).padStart(6)} ` +
    `${`${(entry.cacheCoverage * 100).toFixed(0)}%`.padStart(6)} ` +
    `${formatCompactCost(entry.costPer1MTotal).padStart(8)}`,
    width,
  );
}

export function renderModelEfficiencySection(
  output: TokenleakOutput,
  width: number,
  noColor: boolean,
  options: ModelEfficiencySectionOptions = {},
): string {
  const efficiency = output.more?.modelEfficiency;
  if (!efficiency) {
    return '';
  }

  const title = options.title ?? 'Efficiency Ranking';
  const rankings = efficiency.rankings.slice(0, options.limit ?? 5);
  const includeMethod = options.includeMethod ?? true;
  const includeIneligible = options.includeIneligible ?? true;
  const lines: string[] = [`  ${bold(title, noColor)}`];

  if (includeMethod) {
    lines.push(truncateVisible(`  ${dim(efficiency.method, noColor)}`, width));
  }

  if (rankings.length > 0) {
    lines.push(truncateVisible(`  ${dim('model'.padEnd(Math.min(24, Math.max(12, width - 43))), noColor)} ${dim('score'.padStart(5), noColor)} ${dim('out/$'.padStart(7), noColor)} ${dim('out/in'.padStart(6), noColor)} ${dim('cache'.padStart(6), noColor)} ${dim('$ / 1M'.padStart(8), noColor)}`, width));

    for (const entry of rankings) {
      lines.push(renderEfficiencyRow(entry, width, noColor));
      lines.push(truncateVisible(
        `    ${dim('why', noColor)} ` +
        `${dim(`out/$ ${(entry.scoreBreakdown.outputPerDollar * 100).toFixed(0)}%`, noColor)} ` +
        `${dim(`out/in ${(entry.scoreBreakdown.outputInputRatio * 100).toFixed(0)}%`, noColor)} ` +
        `${dim(`cache ${(entry.scoreBreakdown.cacheCoverage * 100).toFixed(0)}%`, noColor)}`,
        width,
      ));
    }
  } else {
    lines.push(`  ${dim('No eligible models yet.', noColor)}`);
  }

  if (includeIneligible && efficiency.ineligibleModels.length > 0) {
    lines.push('');
    lines.push(`  ${bold('Ineligible', noColor)}`);
    for (const entry of efficiency.ineligibleModels.slice(0, 4)) {
      lines.push(truncateVisible(
        `  ${entry.model} ${dim(`(${entry.eventCount} evt, ${formatTokens(entry.totalTokens)} tok)`, noColor)} ${dim(entry.reason, noColor)}`,
        width,
      ));
    }
    if (efficiency.ineligibleModels.length > 4) {
      lines.push(truncateVisible(
        `  ${dim(`+${efficiency.ineligibleModels.length - 4} more ineligible models`, noColor)}`,
        width,
      ));
    }
  }

  return lines.join('\n');
}

export function renderModelView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const models = output.aggregated.allModels ?? output.aggregated.topModels;
  if (models.length === 0) {
    return `  ${dim('No model data available.', noColor)}`;
  }

  const lines: string[] = [bold('  Models', noColor), ''];

  const nameWidth = Math.min(28, Math.max(12, Math.floor(width * 0.25)));
  const valueWidth = 8;
  const costWidth = 10;
  const shareWidth = 6;
  const barWidth = Math.max(8, width - nameWidth - valueWidth - costWidth - shareWidth - 10);
  const maxTokens = Math.max(...models.map((m) => m.tokens), 0);

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    const colorCode = MODEL_COLORS[i % MODEL_COLORS.length]!;
    const ratio = maxTokens > 0 ? model.tokens / maxTokens : 0;
    const fillLen = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * barWidth));
    const bar = colorize256(BAR_CHAR.repeat(fillLen), colorCode, noColor) +
      dim(TRACK_CHAR.repeat(Math.max(0, barWidth - fillLen)), noColor);
    const shareStr = `${model.percentage.toFixed(0)}%`.padStart(shareWidth);
    const tokStr = formatTokens(model.tokens).padStart(valueWidth);
    const costStr = formatCostWithCompleteness(model.cost, model.costCompleteness).padStart(costWidth);
    const label = formatModelWithTier(model.model, model.serviceTiers);
    const name = label.length > nameWidth
      ? label.slice(0, nameWidth - 1) + '…'
      : label.padEnd(nameWidth);

    lines.push(truncateVisible(
      `  ${colorize256(name, colorCode, noColor)} ${bar} ${shareStr} ${tokStr} ${costStr}`,
      width,
    ));
  }

  // Input/output ratio
  const io = output.more?.inputOutput;
  if (io) {
    lines.push('');
    lines.push(`  ${bold('Input / Output Ratio', noColor)}`);
    const inputShare = 1 - io.outputShare;
    const ioBarWidth = Math.max(10, width - 20);
    const inputLen = Math.round(inputShare * ioBarWidth);
    const outputLen = ioBarWidth - inputLen;
    const ioBar =
      colorize256(BAR_CHAR.repeat(inputLen), SEMANTIC.INPUT, noColor) +
      colorize256(BAR_CHAR.repeat(outputLen), SEMANTIC.OUTPUT, noColor);
    lines.push(truncateVisible(
      `  ${ioBar}  ${dim(`input ${(inputShare * 100).toFixed(0)}%`, noColor)} ${dim(`output ${(io.outputShare * 100).toFixed(0)}%`, noColor)}`,
      width,
    ));
  }

  const roiLines = renderCacheRoiBreakdowns(
    'Cache ROI by Model',
    output.more?.cacheRoi?.byModel ?? [],
    width,
    noColor,
  );
  if (roiLines.length > 0) {
    lines.push('', ...roiLines);
  }

  const efficiencySection = renderModelEfficiencySection(output, width, noColor, {
    title: 'Efficiency Ranking',
    limit: 6,
    includeMethod: true,
    includeIneligible: true,
  });
  if (efficiencySection) {
    lines.push('', efficiencySection);
  }

  return lines.join('\n');
}
