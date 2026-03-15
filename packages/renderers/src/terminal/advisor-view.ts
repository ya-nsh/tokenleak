import type { AdvisorReport, AdvisorRecommendation } from '@tokenleak/core';
import { bold256, bold, dim } from './colors';
import { stripAnsi } from './layout';

const COLOR_TITLE = 68;    // steel blue / cyan
const COLOR_SAVINGS = 71;  // sage green
const COLOR_HIGH = 71;     // green for high confidence
const COLOR_MEDIUM = 179;  // amber for medium confidence
const COLOR_LOW = 140;     // lavender for low confidence

function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function confidenceColor(confidence: 'high' | 'medium' | 'low'): number {
  switch (confidence) {
    case 'high': return COLOR_HIGH;
    case 'medium': return COLOR_MEDIUM;
    case 'low': return COLOR_LOW;
  }
}

function renderRecommendation(
  rec: AdvisorRecommendation,
  width: number,
  noColor: boolean,
): string[] {
  const lines: string[] = [];
  const indent = '  ';
  const contentWidth = width - 4;

  const badge = rec.confidence.toUpperCase();
  const badgeColor = confidenceColor(rec.confidence);

  // Title line
  const icon = noColor ? '*' : '\u{1F4A1}';
  const title = bold256(`${icon} ${rec.title}`, COLOR_TITLE, noColor);
  lines.push(`${indent}${title}`);

  // Description - wrap to width
  const descLines = wrapText(rec.description, contentWidth - 2);
  for (const line of descLines) {
    lines.push(`${indent}   ${dim(line, noColor)}`);
  }

  // Cost line (only for recommendations with cost data)
  if (rec.currentCost > 0 || rec.projectedCost > 0) {
    const current = bold(`${formatDollars(rec.currentCost)}/mo`, noColor);
    const projected = bold256(`${formatDollars(rec.projectedCost)}/mo`, COLOR_SAVINGS, noColor);
    lines.push(`${indent}   Current cost: ${current}  ->  Projected: ${projected}`);
  }

  // Savings line
  if (rec.monthlySavings > 0) {
    const savingsText = bold256(`${formatDollars(rec.monthlySavings)}/mo`, COLOR_SAVINGS, noColor);
    let reductionText = '';
    if (rec.currentCost > 0) {
      reductionText = ` (${formatPercent(rec.monthlySavings / rec.currentCost)} reduction)`;
    }
    const savingsLine = `Savings: ${savingsText}${reductionText}`;
    const badgeStr = bold256(badge, badgeColor, noColor);

    // Right-align badge
    const savingsPlain = stripAnsi(savingsLine);
    const badgePlain = stripAnsi(badgeStr);
    const gap = Math.max(1, contentWidth - 2 - savingsPlain.length - badgePlain.length);
    lines.push(`${indent}   ${savingsLine}${' '.repeat(gap)}${badgeStr}`);
  } else {
    // Just show badge right-aligned
    const badgeStr = bold256(badge, badgeColor, noColor);
    const badgePlain = stripAnsi(badgeStr);
    const gap = Math.max(1, contentWidth - 2 - badgePlain.length);
    lines.push(`${indent}   ${' '.repeat(gap)}${badgeStr}`);
  }

  return lines;
}

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function renderBox(
  title: string,
  subtitle: string,
  width: number,
  noColor: boolean,
): string[] {
  const innerWidth = Math.max(20, width - 4);
  const top = `  \u250C${ '\u2500'.repeat(innerWidth)}\u2510`;
  const bottom = `  \u2514${'\u2500'.repeat(innerWidth)}\u2518`;

  const titleStr = bold256(`  ${title}`, COLOR_TITLE, noColor);
  const titlePad = Math.max(0, innerWidth - stripAnsi(titleStr).length);
  const titleLine = `  \u2502${titleStr}${' '.repeat(titlePad)}\u2502`;

  const subtitleStr = dim(`  ${subtitle}`, noColor);
  const subtitlePad = Math.max(0, innerWidth - stripAnsi(subtitleStr).length);
  const subtitleLine = `  \u2502${subtitleStr}${' '.repeat(subtitlePad)}\u2502`;

  return [top, titleLine, subtitleLine, bottom];
}

/**
 * Render an AdvisorReport as a terminal string with ANSI colors.
 */
export function renderAdvisorView(
  report: AdvisorReport,
  options: { width: number; noColor: boolean },
): string {
  const { width, noColor } = options;
  const lines: string[] = [];

  // Header box
  const subtitle = `Analyzed ${report.analyzedDays} days \u00B7 ${report.analyzedEvents.toLocaleString()} events`;
  lines.push(...renderBox('Model Efficiency Advisor', subtitle, width, noColor));

  if (report.recommendations.length === 0) {
    lines.push('');
    lines.push(`  ${dim('No recommendations -- your usage looks efficient!', noColor)}`);
    lines.push('');
    return lines.join('\n');
  }

  lines.push('');

  // Render each recommendation
  for (let i = 0; i < report.recommendations.length; i++) {
    const rec = report.recommendations[i]!;
    lines.push(...renderRecommendation(rec, width, noColor));
    if (i < report.recommendations.length - 1) {
      lines.push('');
    }
  }

  // Separator
  lines.push('');
  const sepWidth = Math.max(10, width - 4);
  lines.push(`  ${'\u2500'.repeat(sepWidth)}`);
  lines.push('');

  // Summary
  lines.push(`  ${bold('Summary', noColor)}`);

  const currentLabel = '  Current projected monthly cost';
  const projectedLabel = '  Optimized projected monthly cost';
  const savingsLabel = '  Total potential savings';

  const currentVal = bold(formatDollars(report.totalCurrentMonthlyCost), noColor);
  const projectedVal = bold256(formatDollars(report.totalProjectedMonthlyCost), COLOR_SAVINGS, noColor);

  let savingsVal: string;
  if (report.totalCurrentMonthlyCost > 0) {
    const pct = formatPercent(report.totalMonthlySavings / report.totalCurrentMonthlyCost);
    savingsVal = bold256(
      `${formatDollars(report.totalMonthlySavings)}/mo (${pct})`,
      COLOR_SAVINGS,
      noColor,
    );
  } else {
    savingsVal = bold256(`${formatDollars(report.totalMonthlySavings)}/mo`, COLOR_SAVINGS, noColor);
  }

  const labelWidth = Math.max(
    currentLabel.length,
    projectedLabel.length,
    savingsLabel.length,
  );

  lines.push(`${currentLabel.padEnd(labelWidth)}  ${currentVal}`);
  lines.push(`${projectedLabel.padEnd(labelWidth)}  ${projectedVal}`);
  lines.push(`${savingsLabel.padEnd(labelWidth)}  ${savingsVal}`);
  lines.push('');

  return lines.join('\n');
}
