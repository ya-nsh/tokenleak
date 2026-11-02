import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { DateRange, NutritionOutcomeSignal, UsageEvent } from '../types';

async function runGitCommand(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const proc = Bun.spawn(args, {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return { ok: exitCode === 0, stdout };
}

async function isGitRepo(repoRoot: string): Promise<boolean> {
  if (!existsSync(repoRoot)) {
    return false;
  }

  const result = await runGitCommand(['git', '-C', repoRoot, 'rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout.trim() === 'true';
}

async function resolveGitRepoRoot(pathLike: string): Promise<string | null> {
  if (!existsSync(pathLike)) {
    return null;
  }

  const result = await runGitCommand(['git', '-C', pathLike, 'rev-parse', '--show-toplevel']);
  if (!result.ok) {
    return null;
  }

  const toplevel = result.stdout.trim();
  if (!toplevel) return null;

  // A linked worktree (agents create these under .claude/worktrees) shares
  // the main checkout's .git directory; credit its work to the main repo.
  const common = await runGitCommand([
    'git',
    '-C',
    pathLike,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const commonDir = common.ok ? common.stdout.trim() : '';
  return commonDir && basename(commonDir) === '.git' ? dirname(commonDir) : toplevel;
}

function parseGitNumstat(output: string, repoRoot: string): NutritionOutcomeSignal {
  let commits = 0;
  let changedFiles = 0;
  let changedLines = 0;

  for (const line of output.split('\n')) {
    if (line === '__TOKENLEAK_COMMIT__') {
      commits += 1;
      continue;
    }

    const [insertions, deletions] = line.split('\t');
    if (insertions === undefined || deletions === undefined) {
      continue;
    }

    changedFiles += 1;
    const added = Number(insertions);
    const removed = Number(deletions);
    if (Number.isFinite(added)) {
      changedLines += added;
    }
    if (Number.isFinite(removed)) {
      changedLines += removed;
    }
  }

  return {
    repoRoot,
    commits,
    changedFiles,
    changedLines,
  };
}

async function loadGitOutcomeSignal(repoRoot: string, range: DateRange): Promise<NutritionOutcomeSignal | null> {
  if (!(await isGitRepo(repoRoot))) {
    return null;
  }

  // Every local branch, so commits made in agent worktrees count before they
  // merge. No author filter: one person commits as several identities
  // (work email, GitHub noreply, typos in user.email).
  const result = await runGitCommand([
    'git',
    '-C',
    repoRoot,
    'log',
    '--branches',
    `--since=${range.since}T00:00:00`,
    `--until=${range.until}T23:59:59`,
    '--numstat',
    '--pretty=format:__TOKENLEAK_COMMIT__',
  ]);

  if (!result.ok) {
    return null;
  }

  return parseGitNumstat(result.stdout, repoRoot);
}

function uniqueGitCandidatePaths(events: UsageEvent[]): string[] {
  return [...new Set(
    events.flatMap((event) => [
      event.repoRoot?.trim(),
      event.projectId?.trim(),
    ]).filter((pathLike): pathLike is string => Boolean(pathLike)),
  )].sort();
}

export async function collectGitOutcomeSignals(
  events: UsageEvent[],
  range: DateRange,
): Promise<NutritionOutcomeSignal[]> {
  const candidatePaths = uniqueGitCandidatePaths(events);
  const resolvedRoots = (await Promise.all(
    candidatePaths.map((pathLike) => resolveGitRepoRoot(pathLike)),
  )).filter((repoRoot): repoRoot is string => repoRoot !== null);
  const repoRoots = [...new Set(resolvedRoots)].sort();

  return (await Promise.all(
    repoRoots.map((repoRoot) => loadGitOutcomeSignal(repoRoot, range)),
  )).filter((signal): signal is NutritionOutcomeSignal => signal !== null);
}
