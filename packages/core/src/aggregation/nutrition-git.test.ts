import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UsageEvent } from '../types';
import { collectGitOutcomeSignals } from './nutrition-git';
import { buildNutritionReport } from './nutrition';

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(['git', '-C', cwd, ...args], {
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-05-02T10:00:00',
      GIT_COMMITTER_DATE: '2026-05-02T10:00:00',
    },
  });
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
}

async function commit(cwd: string, file: string, email: string): Promise<void> {
  writeFileSync(join(cwd, file), `${file}\n`);
  await git(cwd, 'add', file);
  await git(cwd, '-c', `user.email=${email}`, '-c', 'user.name=Dev', '-c', 'commit.gpgsign=false', 'commit', '-qm', file);
}

function event(projectId: string): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-05-02T10:00:00.000Z',
    date: '2026-05-02',
    model: 'claude-opus-5-5',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
    cost: 1,
    projectId,
  };
}

describe('collectGitOutcomeSignals with agent worktrees', () => {
  test('credits worktree commits and usage to the main repo', async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'tokenleak-roi-')));
    const repo = join(root, 'screen-grabber');
    await Bun.spawn(['mkdir', '-p', repo]).exited;
    await git(repo, 'init', '-q', '-b', 'main');
    await git(repo, 'config', 'user.email', 'me@example.com');
    await commit(repo, 'a.txt', 'me@example.com');
    await commit(repo, 'noreply.txt', 'me@users.noreply.github.com');
    const worktree = join(repo, '.claude', 'worktrees', 'v2-sd-spec');
    await git(repo, 'worktree', 'add', '-q', '-b', 'v2-sd-spec', worktree);
    await commit(worktree, 'b.txt', 'me@example.com');
    await commit(worktree, 'c.txt', 'me@example.com');

    const range = { since: '2026-05-01', until: '2026-05-03' };
    const events = [event(repo), event(worktree)];
    const signals = await collectGitOutcomeSignals(events, range);

    expect(signals.map((signal) => signal.repoRoot)).toEqual([repo]);
    // Commits on the unmerged worktree branch count, under any author identity.
    expect(signals[0]!.commits).toBe(4);

    const report = buildNutritionReport(events, signals, range);
    expect(report.repos).toHaveLength(1);
    expect(report.repos[0]).toMatchObject({ label: 'screen-grabber', commits: 4, cost: 2 });
    expect(report.missingOutcomeRepos).toEqual([]);
  });
});
