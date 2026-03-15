import type { ExplainEvidenceRow, ExplainReport } from '../../core/dist/index.js';

function formatTokens(tokens: number): string {
  return Math.round(tokens).toLocaleString('en-US');
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatShare(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 3) {
    return '.'.repeat(Math.max(0, width));
  }

  return `${value.slice(0, width - 3)}...`;
}

function renderEvidenceTable(title: string, rows: ExplainEvidenceRow[], width: number): string[] {
  const labelWidth = Math.max(16, Math.min(42, width - 33));
  const header = `  ${'Label'.padEnd(labelWidth)} ${'Tokens'.padStart(12)} ${'Share'.padStart(6)} ${'Cost'.padStart(10)}`;
  const divider = `  ${'-'.repeat(Math.max(12, header.length - 2))}`;

  if (rows.length === 0) {
    return [title, '  none'];
  }

  const lines = [title, header, divider];
  for (const row of rows) {
    lines.push(
      `  ${truncate(row.label, labelWidth).padEnd(labelWidth)} ${formatTokens(row.tokens).padStart(12)} ${formatShare(row.share).padStart(6)} ${formatCost(row.cost).padStart(10)}`,
    );
  }

  return lines;
}

export function renderExplainTerminal(report: ExplainReport, width: number = 80): string {
  const lines: string[] = [
    `Explain ${report.date}`,
    report.headline,
    '',
    ...report.summary.map((line: string) => `- ${line}`),
    '',
    ...renderEvidenceTable('Providers', report.topProviders, width),
    '',
    ...renderEvidenceTable('Sessions', report.topSessions, width),
    '',
    ...renderEvidenceTable('Projects', report.topProjects, width),
    '',
    ...renderEvidenceTable('Models', report.topModels, width),
    '',
    'Anomalies',
  ];

  if (report.anomalies.length === 0) {
    lines.push('  none');
  } else {
    for (const anomaly of report.anomalies) {
      lines.push(`  [${anomaly.type}] ${anomaly.title}: ${anomaly.detail}`);
    }
  }

  return lines.join('\n');
}

export function buildExplainHelpText(): string {
  return [
    'Usage:',
    '  tokenleak explain <date> [flags]',
    '',
    'Explain Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -o, --output <path>     Write output to a file and infer format from extension',
    '  -w, --width <number>    Terminal render width',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --claude            Only include Claude Code',
    '      --codex             Only include Codex',
    '      --pi                Only include Pi',
    '      --open-code         Only include OpenCode',
    '      --all-providers     Ignore provider filters and use every available provider',
    '      --no-color          Accepted for parity with terminal output',
    '      --help              Show explain help',
    '',
    'Examples:',
    '  tokenleak explain 2026-03-10',
    '  tokenleak explain 2026-03-10 --format json',
    '  tokenleak explain 2026-03-10 --provider pi --output explain.json',
    '',
  ].join('\n');
}
