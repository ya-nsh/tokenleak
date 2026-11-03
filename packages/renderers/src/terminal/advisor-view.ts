import type { SavingsRecommendation, SavingsReport } from '@tokenleak/core';
import { describePricingGap } from '@tokenleak/core';
import { bold256, bold, dim } from './colors';
import { stripAnsi } from './layout';

const COLOR_TITLE = 68; // steel blue / cyan
const COLOR_SAVINGS = 71; // sage green
const COLOR_HIGH = 71; // green for high confidence
const COLOR_MEDIUM = 179; // amber for medium confidence
const COLOR_LOW = 140; // lavender for low confidence

function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function confidenceColor(confidence: 'high' | 'medium' | 'low'): number {
  switch (confidence) {
    case 'high':
      return COLOR_HIGH;
    case 'medium':
      return COLOR_MEDIUM;
    case 'low':
      return COLOR_LOW;
  }
}

function renderRecommendation(
  rec: SavingsRecommendation,
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

  // What was observed, then what to do about it - wrapped to width
  const action = rec.recipes[0];
  const description = action ? `${rec.evidence.reason} ${action.title}.` : rec.evidence.reason;
  for (const line of wrapText(description, contentWidth - 2)) {
    lines.push(`${indent}   ${dim(line, noColor)}`);
  }
  if (action?.command) {
    lines.push(`${indent}   ${dim(`$ ${action.command}`, noColor)}`);
  }

  const badgeStr = bold256(badge, badgeColor, noColor);
  const badgePlain = stripAnsi(badgeStr);
  const monthlySavings = rec.monthlySavings ?? 0;
  if (monthlySavings > 0) {
    const savingsText = bold256(`${formatDollars(monthlySavings)}/mo`, COLOR_SAVINGS, noColor);
    // Share of the usage this recommendation covers, not of the whole bill.
    const share =
      rec.estimatedSavings !== null && rec.evidence.cost > 0
        ? ` (${formatPercent(rec.estimatedSavings / rec.evidence.cost)} of that usage)`
        : '';
    const savingsLine = `Savings: ${savingsText}${share}`;
    const gap = Math.max(1, contentWidth - 2 - stripAnsi(savingsLine).length - badgePlain.length);
    lines.push(`${indent}   ${savingsLine}${' '.repeat(gap)}${badgeStr}`);
  } else {
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

function renderBox(title: string, subtitle: string, width: number, noColor: boolean): string[] {
  const innerWidth = Math.max(20, width - 4);
  const top = `  \u250C${'\u2500'.repeat(innerWidth)}\u2510`;
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
 * Render the savings report as model-efficiency advice: each recommendation
 * with its monthly savings, then the projected monthly bill.
 */
export function renderAdvisorView(
  report: SavingsReport,
  options: { width: number; noColor: boolean },
): string {
  const { width, noColor } = options;
  const lines: string[] = [];

  // Header box
  const { summary } = report;
  const subtitle = `Analyzed ${summary.analyzedDays} days \u00B7 ${summary.analyzedEvents.toLocaleString()} events`;
  lines.push(...renderBox('Savings Advisor', subtitle, width, noColor));

  const pricingGap = describePricingGap(report);
  if (pricingGap) {
    lines.push('');
    for (const line of wrapText(pricingGap, Math.max(20, width - 4))) {
      lines.push(`  ${dim(line, noColor)}`);
    }
  }

  if (report.recommendations.length === 0) {
    lines.push('');
    lines.push(
      `  ${dim(
        pricingGap
          ? 'No recommendations from the priced share of your usage.'
          : 'No recommendations -- your usage looks efficient!',
        noColor,
      )}`,
    );
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

  const monthlySavings = summary.monthlySavings ?? 0;
  const currentVal = bold(formatDollars(summary.currentMonthlyCost), noColor);
  const projectedVal = bold256(
    formatDollars(Math.max(0, summary.currentMonthlyCost - monthlySavings)),
    COLOR_SAVINGS,
    noColor,
  );

  let savingsVal: string;
  if (summary.currentMonthlyCost > 0) {
    const pct = formatPercent(monthlySavings / summary.currentMonthlyCost);
    savingsVal = bold256(`${formatDollars(monthlySavings)}/mo (${pct})`, COLOR_SAVINGS, noColor);
  } else {
    savingsVal = bold256(`${formatDollars(monthlySavings)}/mo`, COLOR_SAVINGS, noColor);
  }

  const labelWidth = Math.max(currentLabel.length, projectedLabel.length, savingsLabel.length);

  lines.push(`${currentLabel.padEnd(labelWidth)}  ${currentVal}`);
  lines.push(`${projectedLabel.padEnd(labelWidth)}  ${projectedVal}`);
  lines.push(`${savingsLabel.padEnd(labelWidth)}  ${savingsVal}`);
  lines.push('');

  return lines.join('\n');
}
