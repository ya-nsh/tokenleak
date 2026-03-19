import { Box, Text } from '@opentui/core';
import type { AdvisorReport, AdvisorRecommendation } from '@tokenleak/core';
import { formatCost } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

const VISIBLE_ROWS = 10;

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

function renderRecommendation(rec: AdvisorRecommendation, index: number) {
  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Box(
      { flexDirection: 'row', width: '100%' },
      Text({
        content: `\u25B8 ${typeLabel(rec.type)}: ${rec.title}`,
        fg: COLORS.white,
        attributes: BOLD,
      }),
      Text({ content: '  ', fg: COLORS.dimWhite }),
      Text({
        content: confidenceLabel(rec.confidence),
        fg: confidenceColor(rec.confidence),
        attributes: BOLD,
      }),
    ),
    Text({
      content: `  ${rec.description}. Saves ${formatCost(rec.monthlySavings)}/mo`,
      fg: COLORS.dimWhite,
    }),
    Text({ content: '', fg: COLORS.dimWhite }),
  );
}

export function createAdvisorPanel(state: AppState, report: AdvisorReport | null) {
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
  const offset = state.advisorScrollOffset;
  const maxOffset = Math.max(0, recs.length - VISIBLE_ROWS);
  const visibleRecs = recs.slice(offset, offset + VISIBLE_ROWS);

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

  const recNodes = recs.length === 0
    ? [Text({ content: '  No optimization opportunities detected', fg: COLORS.dimWhite })]
    : visibleRecs.map((r, i) => renderRecommendation(r, offset + i));

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
    Text({ content: '', fg: COLORS.dimWhite }),
    ...recNodes,
    ...scrollIndicators,
  );
}
