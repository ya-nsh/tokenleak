import { Box, Text } from '@opentui/core';
import type { ExplainReport, ExplainEvidenceRow, ExplainAnomaly } from '@tokenleak/core';
import { formatCost, formatTokens, formatPercent, padRight, padLeft } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function renderEvidenceTable(title: string, rows: ExplainEvidenceRow[]) {
  if (rows.length === 0) return Box({ flexDirection: 'column', width: '100%' });

  const header = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: padRight(title, 22), fg: COLORS.amber, attributes: BOLD }),
    Text({ content: padLeft('Tokens', 12), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Share', 10), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Cost', 12), fg: COLORS.dimWhite }),
  );

  const rowNodes = rows.slice(0, 8).map((row) =>
    Box(
      { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({ content: padRight(row.label, 22), fg: COLORS.white }),
      Text({ content: padLeft(formatTokens(row.tokens), 12), fg: COLORS.green }),
      Text({ content: padLeft(formatPercent(row.share), 10), fg: COLORS.cyan }),
      Text({ content: padLeft(formatCost(row.cost), 12), fg: COLORS.amber }),
    ),
  );

  return Box(
    { flexDirection: 'column', width: '100%' },
    header,
    ...rowNodes,
    Text({ content: '', fg: COLORS.dimWhite }),
  );
}

function renderAnomalies(anomalies: ExplainAnomaly[]) {
  if (anomalies.length === 0) return Box({ flexDirection: 'column', width: '100%' });

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: 'Anomalies:', fg: COLORS.amber, attributes: BOLD }),
    ...anomalies.map((a) =>
      Text({
        content: `\u26A0 ${a.type}: ${a.detail}`,
        fg: COLORS.red,
      }),
    ),
  );
}

export function createExplainPanel(report: ExplainReport | null, explainDate: string | null) {
  const dateLabel = explainDate ? formatShortDate(explainDate) : '—';

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
      Text({
        content: ` Explain: ${dateLabel} \u25C4 \u25BA `,
        fg: COLORS.amber,
        attributes: BOLD,
      }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: 'No data available for this date', fg: COLORS.dimWhite }),
    );
  }

  const summaryNodes = report.summary.map((s) =>
    Text({ content: `\u2022 ${s}`, fg: COLORS.white }),
  );

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({
      content: ` Explain: ${dateLabel} \u25C4 \u25BA `,
      fg: COLORS.amber,
      attributes: BOLD,
    }),
    Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({
        content: `"${report.headline}"`,
        fg: COLORS.cyan,
        attributes: BOLD,
      }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({
        content: `Tokens: ${formatTokens(report.totalTokens)}  Cost: ${formatCost(report.totalCost)}  vs 7d avg: ${report.comparedTo7dAverage >= 0 ? '+' : ''}${(report.comparedTo7dAverage * 100).toFixed(0)}%  vs 30d avg: ${report.comparedTo30dAverage >= 0 ? '+' : ''}${(report.comparedTo30dAverage * 100).toFixed(0)}%`,
        fg: COLORS.white,
      }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: 'Summary:', fg: COLORS.amber, attributes: BOLD }),
      ...summaryNodes,
      Text({ content: '', fg: COLORS.dimWhite }),
    ),
    renderEvidenceTable('Top Providers', report.topProviders),
    renderEvidenceTable('Top Models', report.topModels),
    renderAnomalies(report.anomalies),
  );
}
