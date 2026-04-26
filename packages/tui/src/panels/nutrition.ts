import { Box, Text } from '@opentui/core';
import type { NutritionRepoSummary, NutritionReport } from '@tokenleak/core';
import { asciiBar, formatCost, formatTokens, padLeft, padRight, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

const VISIBLE_ROWS = 5;
const MAX_REPOS = 30;
const COLUMNS = [
  { title: '#', width: 3, align: 'right' },
  { title: 'Repo', width: 30, align: 'left' },
  { title: 'Tokens', width: 10, align: 'right' },
  { title: 'Cost', width: 9, align: 'right' },
  { title: 'Git Output', width: 13, align: 'right' },
  { title: 'Tok/Commit', width: 11, align: 'right' },
  { title: '$/Commit', width: 10, align: 'right' },
  { title: 'ROI Signal', width: 22, align: 'left' },
] as const;
const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0) + COLUMNS.length + 1;
const DETAIL_WIDTH = TABLE_WIDTH - 2;

function formatNullableNumber(value: number | null, digits: number = 0): string {
  if (value === null) return '-';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatNullableCost(value: number | null): string {
  return value === null ? '-' : `$${value.toFixed(4)}`;
}

function buildEfficiencyRatio(repo: NutritionRepoSummary, maxCostPerCommit: number): number {
  if (repo.costPerCommit === null || maxCostPerCommit <= 0) {
    return 0;
  }
  return 1 - Math.min(repo.costPerCommit / maxCostPerCommit, 1);
}

function middleTruncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  if (maxLen <= 3) return truncate(value, maxLen);

  const edge = Math.floor((maxLen - 3) / 2);
  const tail = maxLen - 3 - edge;
  return `${value.slice(0, edge)}...${value.slice(value.length - tail)}`;
}

function repoIdentity(repo: NutritionRepoSummary): string {
  return repo.repoRoot ?? repo.label;
}

function roiSignal(repo: NutritionRepoSummary, maxCostPerCommit: number): string {
  if (repo.commits <= 0) {
    return 'No Git signal';
  }

  const score = buildEfficiencyRatio(repo, maxCostPerCommit);
  if (score >= 0.66) {
    return `${asciiBar(score, 8)} strong`;
  }
  if (score >= 0.33) {
    return `${asciiBar(score, 8)} ok`;
  }
  return `${asciiBar(score, 8)} weak`;
}

function alignCell(value: string, width: number, align: 'left' | 'right'): string {
  const fitted = middleTruncate(value, width);
  return align === 'right' ? padLeft(fitted, width) : padRight(fitted, width);
}

function gridLine(left: string, join: string, right: string): string {
  return `${left}${COLUMNS.map((column) => '─'.repeat(column.width)).join(join)}${right}`;
}

function gridRow(cells: string[]): string {
  const rendered = COLUMNS.map((column, index) =>
    alignCell(cells[index] ?? '', column.width, column.align),
  );
  return `│${rendered.join('│')}│`;
}

function gridSpan(content: string): string {
  return `│${padRight(middleTruncate(content, DETAIL_WIDTH), DETAIL_WIDTH)}│`;
}

function renderRepoRows(repo: NutritionRepoSummary, rank: number, maxCostPerCommit: number) {
  const signal = roiSignal(repo, maxCostPerCommit);
  const label = repo.label;
  const outcome = repo.commits > 0
    ? `${repo.commits}/${formatTokens(repo.changedLines)}`
    : 'No signal';
  const detail = middleTruncate(repoIdentity(repo), DETAIL_WIDTH);
  const providers = repo.providers.join(', ') || '-';
  const models = repo.models.slice(0, 3).join(', ') || '-';
  const modelDetail = middleTruncate(`providers ${providers}  models ${models}`, DETAIL_WIDTH);

  return [
    Text({
      content: gridRow([
        `${rank}.`,
        label,
        formatTokens(repo.tokens),
        formatCost(repo.cost),
        outcome,
        formatNullableNumber(repo.tokensPerCommit),
        formatNullableCost(repo.costPerCommit),
        signal,
      ]),
      fg: repo.commits > 0 ? COLORS.white : COLORS.red,
    }),
    Text({ content: gridSpan(`repo ${detail}`), fg: COLORS.dimWhite }),
    Text({ content: gridSpan(modelDetail), fg: COLORS.dimWhite }),
    Text({ content: gridLine('├', '┼', '┤'), fg: COLORS.dimWhite }),
  ];
}

export function createNutritionPanel(state: AppState, report: NutritionReport | null) {
  if (!report || report.repos.length === 0) {
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
      Text({ content: ' AI ROI ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({
        content: 'No event-level usage data available. AI ROI needs provider events with repo or project context.',
        fg: COLORS.dimWhite,
      }),
    );
  }

  const repos = report.repos.slice(0, MAX_REPOS);
  const offset = state.nutritionScrollOffset;
  const visible = repos.slice(offset, offset + VISIBLE_ROWS);
  const maxCostPerCommit = Math.max(
    0,
    ...repos.map((repo) => repo.costPerCommit ?? 0),
  );
  const missingCount = report.missingOutcomeRepos.length;

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = repos.length - offset - visible.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  const signalNotice = missingCount > 0
    ? [
        Text({
          content: 'No Git signal: AI usage exists, but no commits were found in this window.',
          fg: COLORS.red,
        }),
        Text({
          content: 'Enable it by opening the repo locally, ensuring it is a Git worktree, and choosing a window with commits.',
          fg: COLORS.red,
        }),
      ]
    : [
        Text({
          content: 'All repo-root usage has matching Git output in this window.',
          fg: COLORS.green,
        }),
      ];

  const tableRows = visible.flatMap((repo, index) =>
    renderRepoRows(repo, offset + index + 1, maxCostPerCommit),
  );
  const trimmedRows = tableRows.length > 0 ? tableRows.slice(0, -1) : tableRows;

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({ content: ' AI ROI: token spend vs Git output ', fg: COLORS.amber, attributes: BOLD }),
    Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({
        content: `Range ${report.dateRange.since} to ${report.dateRange.until}`,
        fg: COLORS.dimWhite,
      }),
      Text({
        content: `Tokens ${formatTokens(report.totals.tokens)}  Cost ${formatCost(report.totals.cost)}  Commits ${report.totals.commits.toLocaleString('en-US')}  Changed lines ${formatTokens(report.totals.changedLines)}`,
        fg: COLORS.white,
      }),
      Text({
        content: `Per commit ${formatNullableNumber(report.totals.tokensPerCommit)} tokens / ${formatNullableCost(report.totals.costPerCommit)}  Per line ${formatNullableNumber(report.totals.tokensPerChangedLine, 1)} tokens / ${formatNullableCost(report.totals.costPerChangedLine)}`,
        fg: COLORS.cyan,
      }),
      Text({
        content: 'ROI Signal compares token/cost spend against local Git commits and changed lines.',
        fg: COLORS.dimWhite,
      }),
      Text({
        content: 'It is directional, not a code quality score.',
        fg: COLORS.dimWhite,
      }),
      ...signalNotice,
      Text({ content: '', fg: COLORS.dimWhite }),
    ),
    Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({ content: gridLine('┌', '┬', '┐'), fg: COLORS.dimWhite }),
      Text({ content: gridRow(COLUMNS.map((column) => column.title)), fg: COLORS.amber, attributes: BOLD }),
      Text({ content: gridLine('├', '┼', '┤'), fg: COLORS.dimWhite }),
      ...trimmedRows,
      Text({ content: gridLine('└', '┴', '┘'), fg: COLORS.dimWhite }),
    ),
    ...scrollIndicators,
  );
}
