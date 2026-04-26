import { Box, Text } from '@opentui/core';
import type { NutritionRepoSummary, NutritionReport } from '@tokenleak/core';
import { asciiBar, formatCost, formatTokens, padLeft, padRight, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

const VISIBLE_ROWS = 8;
const MAX_REPOS = 30;
const DETAIL_WIDTH = 76;
const TABLE_WIDTH = 77;
const REPO_COL = 16;
const TOKEN_COL = 8;
const COST_COL = 8;
const GIT_COL = 11;
const TOK_COMMIT_COL = 9;
const COST_COMMIT_COL = 9;

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

function roiSignal(repo: NutritionRepoSummary, maxCostPerCommit: number): { label: string; bar: string; fg: string } {
  if (repo.commits <= 0) {
    return { label: 'No Git signal', bar: '        ', fg: COLORS.red };
  }

  const score = buildEfficiencyRatio(repo, maxCostPerCommit);
  if (score >= 0.66) {
    return { label: 'strong', bar: asciiBar(score, 8), fg: COLORS.green };
  }
  if (score >= 0.33) {
    return { label: 'ok', bar: asciiBar(score, 8), fg: COLORS.cyan };
  }
  return { label: 'weak', bar: asciiBar(score, 8), fg: COLORS.amber };
}

function renderRepoRow(repo: NutritionRepoSummary, rank: number, maxCostPerCommit: number) {
  const signal = roiSignal(repo, maxCostPerCommit);
  const label = truncate(repo.label, REPO_COL);
  const outcome = repo.commits > 0
    ? `${repo.commits}c/${formatTokens(repo.changedLines)}l`
    : 'No signal';
  const detail = middleTruncate(repoIdentity(repo), DETAIL_WIDTH);
  const providers = repo.providers.join(', ') || '-';
  const models = repo.models.slice(0, 3).join(', ') || '-';
  const modelDetail = middleTruncate(`providers ${providers}  models ${models}`, DETAIL_WIDTH);

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Box(
      { flexDirection: 'row', width: '100%' },
      Text({ content: `${padLeft(`${rank}.`, 3)} `, fg: COLORS.dimWhite }),
      Text({ content: padRight(label, REPO_COL), fg: COLORS.white }),
      Text({ content: padLeft(formatTokens(repo.tokens), TOKEN_COL), fg: COLORS.green }),
      Text({ content: padLeft(formatCost(repo.cost), COST_COL), fg: COLORS.amber }),
      Text({ content: padLeft(outcome, GIT_COL), fg: repo.commits > 0 ? COLORS.cyan : COLORS.red }),
      Text({ content: padLeft(formatNullableNumber(repo.tokensPerCommit), TOK_COMMIT_COL), fg: COLORS.white }),
      Text({ content: padLeft(formatNullableCost(repo.costPerCommit), COST_COMMIT_COL), fg: COLORS.amber }),
      Text({ content: `  ${signal.bar} ${signal.label}`, fg: signal.fg }),
    ),
    Text({
      content: `     repo ${detail}`,
      fg: COLORS.dimWhite,
    }),
    Text({
      content: `     ${modelDetail}`,
      fg: COLORS.dimWhite,
    }),
  );
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

  const columnHeader = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: padRight('', 4), fg: COLORS.dimWhite }),
    Text({ content: padRight('Repo', REPO_COL), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Tokens', TOKEN_COL), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Cost', COST_COL), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Git Output', GIT_COL), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Tok/C', TOK_COMMIT_COL), fg: COLORS.dimWhite }),
    Text({ content: padLeft('$/C', COST_COMMIT_COL), fg: COLORS.dimWhite }),
    Text({ content: '  ROI Signal', fg: COLORS.dimWhite }),
  );

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
    columnHeader,
    Text({ content: ` ${'─'.repeat(TABLE_WIDTH)}`, fg: COLORS.dimWhite }),
    ...visible.map((repo, index) => renderRepoRow(repo, offset + index + 1, maxCostPerCommit)),
    ...scrollIndicators,
  );
}
