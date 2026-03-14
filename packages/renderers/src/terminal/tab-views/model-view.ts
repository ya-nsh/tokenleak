import type { TokenleakOutput } from '@tokenleak/core';
import { colorize256, bold, dim, MODEL_COLORS } from '../colors';
import { truncateVisible } from '../layout';

const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function renderModelView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const models = output.aggregated.topModels;
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
    const costStr = formatCost(model.cost).padStart(costWidth);
    const name = model.model.length > nameWidth
      ? model.model.slice(0, nameWidth - 1) + '…'
      : model.model.padEnd(nameWidth);

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
      colorize256(BAR_CHAR.repeat(inputLen), 33, noColor) +
      colorize256(BAR_CHAR.repeat(outputLen), 40, noColor);
    lines.push(truncateVisible(
      `  ${ioBar}  ${dim(`input ${(inputShare * 100).toFixed(0)}%`, noColor)} ${dim(`output ${(io.outputShare * 100).toFixed(0)}%`, noColor)}`,
      width,
    ));
  }

  return lines.join('\n');
}
