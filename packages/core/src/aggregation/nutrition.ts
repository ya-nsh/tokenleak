import { basename } from 'node:path';
import type {
  DateRange,
  NutritionOutcomeSignal,
  NutritionReport,
  NutritionRepoSummary,
  UsageEvent,
} from '../types';

const METHOD =
  'Agent nutrition label v1: outcome-adjacent metrics join token usage with read-only Git commit, file, and line-change counts for the same date range. These are directional indicators, not proof of productivity or code quality.';

interface RepoAccumulator {
  repoRoot: string | null;
  label: string;
  providers: Set<string>;
  models: Set<string>;
  sessions: Set<string>;
  tokens: number;
  cost: number;
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isSameOrInsidePath(pathLike: string, possibleRoot: string): boolean {
  const path = normalizePathLike(pathLike);
  const root = normalizePathLike(possibleRoot);
  return path === root || path.startsWith(`${root}/`);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function matchedSignal(event: UsageEvent, signals: NutritionOutcomeSignal[]): NutritionOutcomeSignal | null {
  const repoRoot = event.repoRoot?.trim();
  if (repoRoot) {
    const exact = signals.find((signal) => normalizePathLike(signal.repoRoot) === normalizePathLike(repoRoot));
    if (exact) return exact;
  }

  const projectId = event.projectId?.trim();
  if (projectId) {
    let longestMatch: NutritionOutcomeSignal | null = null;
    for (const signal of signals) {
      if (!isSameOrInsidePath(projectId, signal.repoRoot)) {
        continue;
      }

      if (
        !longestMatch ||
        normalizePathLike(signal.repoRoot).length > normalizePathLike(longestMatch.repoRoot).length
      ) {
        longestMatch = signal;
      }
    }
    if (longestMatch) return longestMatch;
  }

  return null;
}

function repoKey(event: UsageEvent, signal: NutritionOutcomeSignal | null): string {
  if (signal) return signal.repoRoot;

  const repoRoot = event.repoRoot?.trim();
  if (repoRoot) return repoRoot;

  const projectId = event.projectId?.trim();
  if (projectId) return `project:${projectId}`;

  return 'unknown';
}

function repoLabel(key: string, repoRoot: string | null): string {
  if (repoRoot) {
    return basename(repoRoot) || repoRoot;
  }
  if (key.startsWith('project:')) {
    const project = key.slice('project:'.length);
    return basename(project) || project;
  }
  return 'Unknown repo';
}

function buildRepoSummary(
  accumulator: RepoAccumulator,
  signal: NutritionOutcomeSignal | null,
): NutritionRepoSummary {
  const commits = signal?.commits ?? 0;
  const changedFiles = signal?.changedFiles ?? 0;
  const changedLines = signal?.changedLines ?? 0;

  return {
    repoRoot: accumulator.repoRoot,
    label: accumulator.label,
    providers: [...accumulator.providers].sort(),
    models: [...accumulator.models].sort(),
    sessions: accumulator.sessions.size,
    tokens: accumulator.tokens,
    cost: accumulator.cost,
    commits,
    changedFiles,
    changedLines,
    tokensPerCommit: ratio(accumulator.tokens, commits),
    costPerCommit: ratio(accumulator.cost, commits),
    tokensPerChangedLine: ratio(accumulator.tokens, changedLines),
    costPerChangedLine: ratio(accumulator.cost, changedLines),
  };
}

export function buildNutritionReport(
  events: UsageEvent[],
  outcomeSignals: NutritionOutcomeSignal[],
  dateRange: DateRange,
): NutritionReport {
  const signalsByRepo = new Map(outcomeSignals.map((signal) => [signal.repoRoot, signal]));
  const byRepo = new Map<string, RepoAccumulator>();

  for (const event of events) {
    const signal = matchedSignal(event, outcomeSignals);
    const key = repoKey(event, signal);
    const repoRoot = signal?.repoRoot ?? event.repoRoot?.trim() ?? null;
    let accumulator = byRepo.get(key);

    if (!accumulator) {
      accumulator = {
        repoRoot,
        label: repoLabel(key, repoRoot),
        providers: new Set(),
        models: new Set(),
        sessions: new Set(),
        tokens: 0,
        cost: 0,
      };
      byRepo.set(key, accumulator);
    }

    accumulator.providers.add(event.provider);
    accumulator.models.add(event.model);
    if (event.sessionId) {
      accumulator.sessions.add(event.sessionId);
    }
    accumulator.tokens += event.totalTokens;
    accumulator.cost += event.cost;
  }

  const repos = [...byRepo.entries()]
    .map(([key, accumulator]) => {
      const signal = accumulator.repoRoot ? signalsByRepo.get(accumulator.repoRoot) ?? null : null;
      return { key, summary: buildRepoSummary(accumulator, signal) };
    })
    .sort((left, right) => (
      right.summary.cost - left.summary.cost ||
      right.summary.tokens - left.summary.tokens ||
      left.summary.label.localeCompare(right.summary.label)
    ));

  const summaries = repos.map((repo) => repo.summary);
  const totals = summaries.reduce(
    (acc, summary) => {
      acc.tokens += summary.tokens;
      acc.cost += summary.cost;
      acc.commits += summary.commits;
      acc.changedFiles += summary.changedFiles;
      acc.changedLines += summary.changedLines;
      return acc;
    },
    {
      tokens: 0,
      cost: 0,
      commits: 0,
      changedFiles: 0,
      changedLines: 0,
    },
  );

  const missingOutcomeRepos = repos
    .filter((repo) => repo.summary.repoRoot !== null && repo.summary.commits === 0)
    .map((repo) => repo.summary.repoRoot!)
    .sort();

  return {
    method: METHOD,
    dateRange,
    totals: {
      ...totals,
      tokensPerCommit: ratio(totals.tokens, totals.commits),
      costPerCommit: ratio(totals.cost, totals.commits),
      tokensPerChangedLine: ratio(totals.tokens, totals.changedLines),
      costPerChangedLine: ratio(totals.cost, totals.changedLines),
    },
    repos: summaries,
    missingOutcomeRepos,
  };
}
