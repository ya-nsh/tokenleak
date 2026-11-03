import { Box, Text } from '@opentui/core';
import type { SavingsCategory, SavingsRecommendation, SavingsReport } from '@tokenleak/core';
import { describePricingGap } from '@tokenleak/core';
import { formatCost, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

export const ADVISOR_VISIBLE_ITEMS = 5;
const CONTENT_WIDTH = 72;
const MAX_BODY_LINES = 2;
/**
 * Each recommendation is a title, at most two description lines and a blank
 * line, so five fit a standard terminal. Recipes live in the Waste view.
 */
export const ADVISOR_LINES_PER_ITEM = 1 + MAX_BODY_LINES + 1;

function confidenceColor(c: 'high' | 'medium' | 'low'): string {
  if (c === 'high') return COLORS.green;
  if (c === 'medium') return COLORS.amber;
  return COLORS.dimWhite;
}

function confidenceLabel(c: 'high' | 'medium' | 'low'): string {
  return `[${c.toUpperCase()}]`;
}

const CATEGORY_LABELS: Record<SavingsCategory, string> = {
  routing: 'Model Routing',
  cache: 'Cache',
  session: 'Session',
  spend: 'Spend Pattern',
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function wrapText(value: string, width: number, maxLines: number = MAX_BODY_LINES): string[] {
  const words = cleanText(value).split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    } else {
      lines.push(truncate(word, width));
    }

    if (lines.length >= maxLines) {
      break;
    }
    current = word.length > width ? truncate(word, width) : word;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1]!, width);
  }

  return lines.length > 0 ? lines : [''];
}

function textLines(lines: string[], fg: string) {
  return lines.map((line) => Text({ content: line, fg }));
}

function indentedTextLines(value: string, fg: string) {
  const indent = '  ';
  return textLines(
    wrapText(value, CONTENT_WIDTH - indent.length).map((line) => `${indent}${line}`),
    fg,
  );
}

function titleLine(title: string, badge: string): string {
  const prefix = '\u25B8 ';
  const titleWidth = Math.max(12, CONTENT_WIDTH - prefix.length - 2 - badge.length);
  return `${prefix}${truncate(title, titleWidth)}  ${badge}`;
}

/** Monthly saving for a title line; findings without an estimate show none. */
function formatSavings(value: number | null): string | null {
  return value === null ? null : `${formatCost(value)}/mo`;
}

function renderRecommendation(rec: SavingsRecommendation) {
  // The saving rides on the title line so a long reason can never push it out of view.
  const badge = [formatSavings(rec.monthlySavings), confidenceLabel(rec.confidence)]
    .filter((part): part is string => part !== null)
    .join('  ');
  const title = `${CATEGORY_LABELS[rec.category]}: ${cleanText(rec.title)}`;
  const description = cleanText(rec.evidence.reason);

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: titleLine(title, badge),
      fg: confidenceColor(rec.confidence),
      attributes: BOLD,
    }),
    ...indentedTextLines(description, COLORS.dimWhite),
    Text({ content: '', fg: COLORS.dimWhite }),
  );
}

export function createAdvisorPanel(state: AppState, report: SavingsReport | null) {
  if (!report) {
    return Box(
      {
        flexDirection: 'column',
        width: '100%',
        flexGrow: 1,
        borderStyle: 'single',
        borderColor: COLORS.dimWhite,
        paddingLeft: 1,
        paddingRight: 1,
      },
      Text({ content: ' Advisor ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: 'No event data available for analysis', fg: COLORS.dimWhite }),
    );
  }

  const { summary } = report;
  const recs = report.recommendations;
  const pricingGap = describePricingGap(report);
  const maxOffset = Math.max(0, recs.length - ADVISOR_VISIBLE_ITEMS);
  const offset = Math.min(state.advisorScrollOffset, maxOffset);
  const visibleRecs = recs.slice(offset, offset + ADVISOR_VISIBLE_ITEMS);
  const monthlySavings = summary.monthlySavings ?? 0;

  const summaryRow = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: `Current: ${formatCost(summary.currentMonthlyCost)}/mo`, fg: COLORS.white }),
    Text({ content: '  \u2192  ', fg: COLORS.dimWhite }),
    Text({
      content: `Projected: ${formatCost(Math.max(0, summary.currentMonthlyCost - monthlySavings))}/mo`,
      fg: COLORS.green,
    }),
    Text({ content: '  |  ', fg: COLORS.dimWhite }),
    Text({
      content: `Savings: ${formatCost(monthlySavings)}/mo`,
      fg: COLORS.amber,
      attributes: BOLD,
    }),
  );

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = recs.length - offset - visibleRecs.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({ content: ' Advisor ', fg: COLORS.amber, attributes: BOLD }),
    summaryRow,
    ...(pricingGap ? [Text({ content: `  ${pricingGap}`, fg: COLORS.amber })] : []),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: ' Savings Recommendations ', fg: COLORS.amber, attributes: BOLD }),
    ...(visibleRecs.length > 0
      ? visibleRecs.map(renderRecommendation)
      : [
          Text({
            content: pricingGap
              ? '  No opportunities in the priced share of your usage'
              : '  No optimization opportunities detected',
            fg: COLORS.dimWhite,
          }),
        ]),
    ...scrollIndicators,
  );
}
