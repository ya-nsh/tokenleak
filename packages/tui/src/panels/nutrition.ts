import { Box, Text } from '@opentui/core';
import type { NutritionRepoSummary, NutritionReport } from '@tokenleak/core';
import { asciiBar, formatCost, formatTokens, padLeft, padRight, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

const VISIBLE_ROWS = 10;
const MAX_REPOS = 30;

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

function renderRepoRow(repo: NutritionRepoSummary, rank: number, labelWidth: number, maxCostPerCommit: number) {
  const score = buildEfficiencyRatio(repo, maxCostPerCommit);
  const bar = asciiBar(score, 8);
  const label = truncate(repo.label, labelWidth);
  const outcome = repo.commits > 0
    ? `${repo.commits}c/${formatTokens(repo.changedLines)}l`
    : 'no git signal';

  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Box(
      { flexDirection: 'row', width: '100%' },
      Text({ content: `${padLeft(`${rank}.`, 3)} `, fg: COLORS.dimWhite }),
      Text({ content: `${bar} `, fg: repo.commits > 0 ? COLORS.green : COLORS.dimWhite }),
      Text({ content: padRight(label, labelWidth + 2), fg: COLORS.white }),
      Text({ content: padLeft(formatTokens(repo.tokens), 10), fg: COLORS.green }),
      Text({ content: padLeft(formatCost(repo.cost), 9), fg: COLORS.amber }),
      Text({ content: padLeft(outcome, 15), fg: repo.commits > 0 ? COLORS.cyan : COLORS.red }),
      Text({ content: padLeft(formatNullableNumber(repo.tokensPerCommit), 12), fg: COLORS.white }),
      Text({ content: padLeft(formatNullableCost(repo.costPerCommit), 11), fg: COLORS.amber }),
    ),
    Text({
      content: `      providers ${repo.providers.join(', ') || '-'}  models ${repo.models.slice(0, 3).join(', ') || '-'}`,
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
      Text({ content: ' Nutrition Label ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({
        content: 'No event-level usage data available. Nutrition needs provider events with repo or project context.',
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
  const maxLabel = Math.max(12, ...visible.map((repo) => repo.label.length));
  const labelWidth = Math.min(28, maxLabel);
  const missingCount = report.missingOutcomeRepos.length;

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = repos.length - offset - visible.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  const columnHeader = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: padRight('', 4), fg: COLORS.dimWhite }),
    Text({ content: padRight('Value', 9), fg: COLORS.dimWhite }),
    Text({ content: padRight('Repo', labelWidth + 2), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Tokens', 10), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Cost', 9), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Outcome', 15), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Tok/Commit', 12), fg: COLORS.dimWhite }),
    Text({ content: padLeft('$/Commit', 11), fg: COLORS.dimWhite }),
  );

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({ content: ' Nutrition Label ', fg: COLORS.amber, attributes: BOLD }),
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
        content: missingCount > 0
          ? `${missingCount} repo(s) have usage but no commit signal in this window.`
          : 'All repo-root usage has a matching Git outcome signal.',
        fg: missingCount > 0 ? COLORS.red : COLORS.green,
      }),
      Text({ content: '', fg: COLORS.dimWhite }),
    ),
    columnHeader,
    ...visible.map((repo, index) => renderRepoRow(repo, offset + index + 1, labelWidth, maxCostPerCommit)),
    ...scrollIndicators,
  );
}
