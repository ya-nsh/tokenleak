import { Box, Text } from '@opentui/core';
import type { AdvisorReport, AdvisorRecommendation, WasteFinding, WasteReport } from '@tokenleak/core';
import { formatCost, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

export const ADVISOR_VISIBLE_ITEMS = 5;
const CONTENT_WIDTH = 72;
const MAX_BODY_LINES = 2;

function confidenceColor(c: 'high' | 'medium' | 'low'): string {
  if (c === 'high') return COLORS.green;
  if (c === 'medium') return COLORS.amber;
  return COLORS.dimWhite;
}

function confidenceLabel(c: 'high' | 'medium' | 'low'): string {
  return `[${c.toUpperCase()}]`;
}

function typeLabel(type: AdvisorRecommendation['type']): string {
  if (type === 'model-downgrade') return 'Model Downgrade';
  if (type === 'cache-optimization') return 'Cache Optimization';
  return 'Usage Pattern';
}

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

function renderRecommendation(rec: AdvisorRecommendation) {
  const badge = confidenceLabel(rec.confidence);
  const title = `${typeLabel(rec.type)}: ${cleanText(rec.title)}`;
  const description = `${cleanText(rec.description)} Saves ${formatCost(rec.monthlySavings)}/mo`;

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: titleLine(title, badge),
      fg: confidenceColor(rec.confidence),
      attributes: BOLD,
    }),
    ...indentedTextLines(description, COLORS.dimWhite),
    Text({
      content: '',
      fg: COLORS.dimWhite,
    }),
  );
}

function severityColor(severity: WasteFinding['severity']): string {
  if (severity === 'high') return COLORS.red;
  if (severity === 'medium') return COLORS.amber;
  return COLORS.dimWhite;
}

function categoryLabel(category: WasteFinding['category']): string {
  return category.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}

function formatSavings(value: number | null): string {
  return value === null ? 'not estimated' : `${formatCost(value)}/mo`;
}

function renderWasteFinding(finding: WasteFinding) {
  const recipe = finding.recipes[0];
  const scope = [finding.provider, finding.model].filter(Boolean).join(' / ');
  const badge = `[${finding.severity.toUpperCase()}]`;
  const title = `${categoryLabel(finding.category)}: ${cleanText(finding.title)}`;
  const savings = `Savings: ${formatSavings(finding.estimatedMonthlySavings)}${scope ? `  Scope: ${scope}` : ''}`;
  const recipeText = recipe ? `Recipe: ${recipe.title} - ${recipe.detail}` : '';

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: titleLine(title, badge),
      fg: severityColor(finding.severity),
      attributes: BOLD,
    }),
    ...indentedTextLines(`Evidence: ${finding.evidence}`, COLORS.dimWhite),
    Text({
      content: `  ${truncate(savings, CONTENT_WIDTH - 2)}`,
      fg: COLORS.dimWhite,
    }),
    ...(recipe ? indentedTextLines(recipeText, COLORS.cyan) : []),
    Text({ content: '', fg: COLORS.dimWhite }),
  );
}

export function createAdvisorPanel(
  state: AppState,
  report: AdvisorReport | null,
  wasteReport: WasteReport | null,
) {
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

  const recs = report.recommendations;
  const wasteFindings = wasteReport?.findings ?? [];
  const items = [
    ...recs.map((rec) => ({ type: 'recommendation' as const, rec })),
    ...wasteFindings.map((finding) => ({ type: 'waste' as const, finding })),
  ];
  const maxOffset = Math.max(0, items.length - ADVISOR_VISIBLE_ITEMS);
  const offset = Math.min(state.advisorScrollOffset, maxOffset);
  const visibleItems = items.slice(offset, offset + ADVISOR_VISIBLE_ITEMS);

  const summaryRow = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: `Current: ${formatCost(report.totalCurrentMonthlyCost)}/mo`,
      fg: COLORS.white,
    }),
    Text({ content: '  \u2192  ', fg: COLORS.dimWhite }),
    Text({
      content: `Projected: ${formatCost(report.totalProjectedMonthlyCost)}/mo`,
      fg: COLORS.green,
    }),
    Text({ content: '  |  ', fg: COLORS.dimWhite }),
    Text({
      content: `Savings: ${formatCost(report.totalMonthlySavings)}/mo`,
      fg: COLORS.amber,
      attributes: BOLD,
    }),
  );

  const visibleRecNodes = visibleItems
    .filter((item) => item.type === 'recommendation')
    .map((item) => renderRecommendation(item.rec));
  const visibleWasteNodes = visibleItems
    .filter((item) => item.type === 'waste')
    .map((item) => renderWasteFinding(item.finding));
  const showSavingsSection = visibleRecNodes.length > 0 || recs.length === 0;
  const showWasteSection = visibleWasteNodes.length > 0 || wasteFindings.length === 0;

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = items.length - offset - visibleItems.length;
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
    Text({ content: '', fg: COLORS.dimWhite }),
    ...(showSavingsSection ? [Text({ content: ' Savings Recommendations ', fg: COLORS.amber, attributes: BOLD })] : []),
    ...(visibleRecNodes.length > 0
      ? visibleRecNodes
      : recs.length === 0
        ? [Text({ content: '  No optimization opportunities detected', fg: COLORS.dimWhite })]
        : []),
    ...(showWasteSection ? [Text({ content: ' Waste Patterns ', fg: COLORS.amber, attributes: BOLD })] : []),
    ...(showWasteSection && wasteReport && !wasteReport.enoughEvidence
      ? [Text({
          content: '  Not enough event-level data for confident waste taxonomy yet.',
          fg: COLORS.dimWhite,
        })]
      : []),
    ...(visibleWasteNodes.length > 0
      ? visibleWasteNodes
      : wasteFindings.length === 0
        ? [Text({ content: '  No deterministic waste patterns detected', fg: COLORS.dimWhite })]
        : []),
    ...scrollIndicators,
  );
}
