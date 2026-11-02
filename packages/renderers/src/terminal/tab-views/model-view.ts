import { formatTokenCount } from '@tokenleak/core';
import type { ModelEfficiencyEntry, TokenleakOutput } from '@tokenleak/core';
import { colorize256, bold, dim, SEMANTIC } from '../colors';
import { truncateVisible } from '../layout';


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
    `${formatTokenCount(entry.outputPerDollar).padStart(7)} ` +
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
        `  ${entry.model} ${dim(`(${entry.eventCount} evt, ${formatTokenCount(entry.totalTokens)} tok)`, noColor)} ${dim(entry.reason, noColor)}`,
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
