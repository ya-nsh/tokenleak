import { Box, Text } from '@opentui/core';
import type { NutritionRepoSummary, NutritionReport } from '@tokenleak/core';
import {
  asciiBar,
  formatCost,
  formatTokens,
  padLeft,
  padRight,
  truncate,
  formatRowCost,
} from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';
import { fitItems } from '../lib/layout.js';

export const NUTRITION_VISIBLE_ROWS = 5;
/** Each repo is a data row, two detail rows and a separator. */
const NUTRITION_ROWS_PER_ITEM = 4;
/**
 * Border, title, the seven-row summary (range, totals, per-unit, two notes,
 * signal headline and detail), blank, the table's top, header and divider,
 * its bottom, and both scroll indicators. The last repo drops its separator.
 */
const NUTRITION_FIXED_ROWS = 2 + 1 + 7 + 1 + 3 + 1 + 2 - 1;

/** Repos per page in `height` rows. */
export function nutritionVisibleRows(height: number): number {
  return fitItems(height, NUTRITION_FIXED_ROWS, NUTRITION_ROWS_PER_ITEM, NUTRITION_VISIBLE_ROWS);
}
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
/** The table at full column widths, borders included. */
export const NUTRITION_TABLE_WIDTH =
  COLUMNS.reduce((sum, column) => sum + column.width, 0) + COLUMNS.length + 1;
/** Columns that give up width on narrow terminals, in order, down to these minimums. */
const SHRINKABLE_COLUMNS: ReadonlyArray<{ index: number; minWidth: number }> = [
  { index: 1, minWidth: 12 }, // Repo: the full path is on the detail row below
  { index: 7, minWidth: 15 }, // ROI Signal: fits the bar and its label
];

interface TableLayout {
  widths: number[];
  /** Inner width of the full-width detail rows. */
  detailWidth: number;
}

/**
 * Column widths that fit `contentWidth`, so table lines never wrap (a
 * wrapped line takes two rows and breaks the panel's height budget).
 */
function tableLayout(contentWidth: number): TableLayout {
  const widths: number[] = COLUMNS.map((column) => column.width);
  let excess = Number.isFinite(contentWidth) ? NUTRITION_TABLE_WIDTH - contentWidth : 0;
  for (const { index, minWidth } of SHRINKABLE_COLUMNS) {
    if (excess <= 0) break;
    const give = Math.min(excess, widths[index]! - minWidth);
    widths[index]! -= give;
    excess -= give;
  }
  return {
    widths,
    detailWidth: widths.reduce((sum, width) => sum + width, 0) + COLUMNS.length - 1,
  };
}

function formatNullableNumber(value: number | null, digits: number = 0): string {
  if (value === null) return '-';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatNullableCost(value: number | null): string {
  return value === null ? '-' : formatCost(value);
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

function gridLine(layout: TableLayout, left: string, join: string, right: string): string {
  return `${left}${layout.widths.map((width) => '─'.repeat(width)).join(join)}${right}`;
}

function gridRow(layout: TableLayout, cells: string[]): string {
  const rendered = COLUMNS.map((column, index) =>
    alignCell(cells[index] ?? '', layout.widths[index]!, column.align),
  );
  return `│${rendered.join('│')}│`;
}

function gridSpan(layout: TableLayout, content: string): string {
  return `│${padRight(middleTruncate(content, layout.detailWidth), layout.detailWidth)}│`;
}

function renderRepoRows(
  layout: TableLayout,
  repo: NutritionRepoSummary,
  rank: number,
  maxCostPerCommit: number,
) {
  const signal = roiSignal(repo, maxCostPerCommit);
  const label = repo.label;
  const outcome =
    repo.commits > 0 ? `${repo.commits}/${formatTokens(repo.changedLines)}` : 'No signal';
  const detail = middleTruncate(repoIdentity(repo), layout.detailWidth);
  const providers = repo.providers.join(', ') || '-';
  const models = repo.models.slice(0, 3).join(', ') || '-';
  const modelDetail = middleTruncate(
    `providers ${providers}  models ${models}`,
    layout.detailWidth,
  );

  return [
    Text({
      content: gridRow(layout, [
        `${rank}.`,
        label,
        formatTokens(repo.tokens),
        formatRowCost(repo.cost, repo.costCompleteness),
        outcome,
        formatNullableNumber(repo.tokensPerCommit),
        formatNullableCost(repo.costPerCommit),
        signal,
      ]),
      fg: repo.commits > 0 ? COLORS.white : COLORS.red,
    }),
    Text({ content: gridSpan(layout, `repo ${detail}`), fg: COLORS.dimWhite }),
    Text({ content: gridSpan(layout, modelDetail), fg: COLORS.dimWhite }),
    Text({ content: gridLine(layout, '├', '┼', '┤'), fg: COLORS.dimWhite }),
  ];
}

export interface GitSignalNotice {
  tone: 'ok' | 'partial' | 'none';
  headline: string;
  detail: string | null;
}

/**
 * Describe Git coverage for the window. The old banner said "no commits were
 * found" whenever any single repo lacked commits, right under a total of
 * 1,350 commits.
 */
export function describeGitSignal(
  totalCommits: number,
  reposWithoutCommits: number,
): GitSignalNotice {
  const repos = `${reposWithoutCommits} repo${reposWithoutCommits === 1 ? '' : 's'}`;
  if (reposWithoutCommits === 0) {
    return {
      tone: 'ok',
      headline: 'Every repo with AI usage has matching Git commits in this window.',
      detail: null,
    };
  }
  if (totalCommits > 0) {
    return {
      tone: 'partial',
      headline: `${repos} had AI usage but no commits in this window (marked "No signal").`,
      detail: 'They may be scratch work, or live outside a local Git checkout.',
    };
  }
  return {
    tone: 'none',
    headline: 'No Git signal: AI usage exists, but no commits were found in this window.',
    detail: 'Open the repo locally as a Git checkout, or choose a window that contains commits.',
  };
}

export function createNutritionPanel(
  state: AppState,
  report: NutritionReport | null,
  height = Number.POSITIVE_INFINITY,
  contentWidth = Number.POSITIVE_INFINITY,
) {
  if (state.nutritionSignalsLoading) {
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
        content: 'Loading local Git outcome signals...',
        fg: COLORS.dimWhite,
      }),
    );
  }

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
        content:
          'No event-level usage data available. AI ROI needs provider events with repo or project context.',
        fg: COLORS.dimWhite,
      }),
    );
  }

  const repos = report.repos.slice(0, MAX_REPOS);
  const layout = tableLayout(contentWidth);
  const pageSize = nutritionVisibleRows(height);
  const offset = Math.min(state.nutritionScrollOffset, Math.max(0, repos.length - pageSize));
  const visible = repos.slice(offset, offset + pageSize);
  const maxCostPerCommit = Math.max(0, ...repos.map((repo) => repo.costPerCommit ?? 0));
  const missingCount = report.missingOutcomeRepos.length;

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = repos.length - offset - visible.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  const notice = describeGitSignal(report.totals.commits, missingCount);
  const signalNotice = [
    Text({
      content: notice.headline,
      fg:
        notice.tone === 'ok' ? COLORS.green : notice.tone === 'partial' ? COLORS.amber : COLORS.red,
    }),
    ...(notice.detail ? [Text({ content: notice.detail, fg: COLORS.dimWhite })] : []),
  ];

  const tableRows = visible.flatMap((repo, index) =>
    renderRepoRows(layout, repo, offset + index + 1, maxCostPerCommit),
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
        content: `Tokens ${formatTokens(report.totals.tokens)}  Cost ${formatRowCost(report.totals.cost, report.totals.costCompleteness)}  Commits ${report.totals.commits.toLocaleString('en-US')}  Changed lines ${formatTokens(report.totals.changedLines)}`,
        fg: COLORS.white,
      }),
      Text({
        content: `Per commit ${formatNullableNumber(report.totals.tokensPerCommit)} tokens / ${formatNullableCost(report.totals.costPerCommit)}  Per line ${formatNullableNumber(report.totals.tokensPerChangedLine, 1)} tokens / ${formatNullableCost(report.totals.costPerChangedLine)}`,
        fg: COLORS.cyan,
      }),
      Text({
        content:
          'ROI Signal compares token/cost spend against local Git commits and changed lines.',
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
      Text({ content: gridLine(layout, '┌', '┬', '┐'), fg: COLORS.dimWhite }),
      Text({
        content: gridRow(
          layout,
          COLUMNS.map((column) => column.title),
        ),
        fg: COLORS.amber,
        attributes: BOLD,
      }),
      Text({ content: gridLine(layout, '├', '┼', '┤'), fg: COLORS.dimWhite }),
      ...trimmedRows,
      Text({ content: gridLine(layout, '└', '┴', '┘'), fg: COLORS.dimWhite }),
    ),
    ...scrollIndicators,
  );
}
