import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitCorrelator, parseGitLog } from './git-correlator';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

function commitAt(repo: string, filename: string, content: string, unixSeconds: number): void {
  writeFileSync(join(repo, filename), content);
  const date = `${unixSeconds} +0000`;
  execFileSync('git', ['add', filename], { cwd: repo, stdio: 'ignore' });
  execFileSync(
    'git',
    ['commit', '-m', `add ${filename}`, '--date', date],
    {
      cwd: repo,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    },
  );
}

describe('parseGitLog', () => {
  it('parses a single commit with shortstat', () => {
    const raw = '\x00abc123\x011700000000\x01Initial commit\n\n 2 files changed, 10 insertions(+), 3 deletions(-)\n';
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: 'abc123',
      timestamp: 1700000000000,
      subject: 'Initial commit',
      filesChanged: 2,
      insertions: 10,
      deletions: 3,
    });
  });

  it('parses multiple commits', () => {
    const raw =
      '\x00aaa\x011700000000\x01first\n\n 1 file changed, 5 insertions(+)\n' +
      '\x00bbb\x011700003600\x01second\n\n 2 files changed, 1 insertion(+), 1 deletion(-)\n';
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.sha).toBe('aaa');
    expect(commits[0]!.insertions).toBe(5);
    expect(commits[0]!.deletions).toBe(0);
    expect(commits[1]!.sha).toBe('bbb');
    expect(commits[1]!.insertions).toBe(1);
    expect(commits[1]!.deletions).toBe(1);
  });

  it('handles subjects containing the field delimiter', () => {
    const raw = '\x00sha\x011700000000\x01weird\x01subject\n\n 1 file changed, 1 insertion(+)\n';
    const commits = parseGitLog(raw);
    expect(commits[0]!.subject).toBe('weird\x01subject');
  });

  it('returns empty array for empty input', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  it('skips malformed entries without ctime', () => {
    const raw = '\x00onlySha\n\n 1 file changed, 1 insertion(+)\n';
    expect(parseGitLog(raw)).toEqual([]);
  });

  it('records zero lines changed when shortstat is missing', () => {
    const raw = '\x00abc\x011700000000\x01no stat\n';
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.filesChanged).toBe(0);
    expect(commits[0]!.insertions).toBe(0);
    expect(commits[0]!.deletions).toBe(0);
  });
});

describe('GitCorrelator', () => {
  let tmpRoot: string;
  let repo: string;
  let cacheDir: string;

  const T0 = 1_700_000_000;
  const T1 = T0 + 3_600;
  const T2 = T0 + 7_200;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'tokenleak-git-correlator-'));
    repo = join(tmpRoot, 'repo');
    cacheDir = join(tmpRoot, 'cache');
    mkdirSync(repo, { recursive: true });

    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'commit.gpgsign', 'false');

    commitAt(repo, 'a.txt', 'hello\n', T0);
    commitAt(repo, 'b.txt', 'world\n', T1);
    commitAt(repo, 'c.txt', 'three\nfour\n', T2);
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns empty commits for non-git paths', () => {
    const correlator = new GitCorrelator({ cacheDir });
    expect(correlator.getCommits(tmpRoot)).toEqual([]);
    expect(correlator.getCommits('')).toEqual([]);
    expect(correlator.getCommits('/nonexistent/path/xyz')).toEqual([]);
  });

  it('reads all commits from a real repo', () => {
    const correlator = new GitCorrelator({ cacheDir });
    const commits = correlator.getCommits(repo);
    expect(commits).toHaveLength(3);
    const timestamps = commits.map((c) => c.timestamp).sort((a, b) => a - b);
    expect(timestamps).toEqual([T0 * 1000, T1 * 1000, T2 * 1000]);
  });

  it('caches in memory (second call does not re-invoke git)', () => {
    const correlator = new GitCorrelator({ cacheDir });
    const first = correlator.getCommits(repo);
    const second = correlator.getCommits(repo);
    expect(second).toBe(first);
  });

  it('marks a session as shipped when a commit lands within the session itself', () => {
    const correlator = new GitCorrelator({ cacheDir, shipWindowMs: 0 });
    const status = correlator.didSessionShip({
      start: new Date((T0 - 60) * 1000).toISOString(),
      end: new Date((T0 + 60) * 1000).toISOString(),
      repoRoot: repo,
    });
    expect(status.shipped).toBe(true);
    expect(status.commits).toHaveLength(1);
    expect(status.linesChanged).toBeGreaterThan(0);
  });

  it('counts a commit within the grace window after session end as shipped', () => {
    const correlator = new GitCorrelator({ cacheDir, shipWindowMs: 7_200_000 });
    const status = correlator.didSessionShip({
      start: new Date((T0 - 60) * 1000).toISOString(),
      end: new Date((T0 + 60) * 1000).toISOString(),
      repoRoot: repo,
    });
    expect(status.shipped).toBe(true);
    expect(status.commits.length).toBeGreaterThanOrEqual(2);
  });

  it('marks a session as unshipped when no commit falls in the window', () => {
    const correlator = new GitCorrelator({ cacheDir, shipWindowMs: 0 });
    const status = correlator.didSessionShip({
      start: new Date((T2 + 3_600) * 1000).toISOString(),
      end: new Date((T2 + 7_200) * 1000).toISOString(),
      repoRoot: repo,
    });
    expect(status.shipped).toBe(false);
    expect(status.commits).toEqual([]);
    expect(status.linesChanged).toBe(0);
  });

  it('returns unshipped for malformed session timestamps', () => {
    const correlator = new GitCorrelator({ cacheDir });
    const status = correlator.didSessionShip({
      start: 'not-a-date',
      end: 'also-not-a-date',
      repoRoot: repo,
    });
    expect(status.shipped).toBe(false);
  });

  it('returns unshipped for non-git repo paths', () => {
    const correlator = new GitCorrelator({ cacheDir });
    const status = correlator.didSessionShip({
      start: new Date(T0 * 1000).toISOString(),
      end: new Date(T1 * 1000).toISOString(),
      repoRoot: tmpRoot,
    });
    expect(status.shipped).toBe(false);
  });

  it('commitsInRange filters by timestamp bounds', () => {
    const correlator = new GitCorrelator({ cacheDir });
    const inRange = correlator.commitsInRange(
      repo,
      (T1 - 30) * 1000,
      (T1 + 30) * 1000,
    );
    expect(inRange).toHaveLength(1);
  });

  it('writes and reads a disk cache keyed by HEAD log mtime', () => {
    const freshCacheDir = join(tmpRoot, 'fresh-cache');
    const first = new GitCorrelator({ cacheDir: freshCacheDir });
    first.getCommits(repo);

    const second = new GitCorrelator({ cacheDir: freshCacheDir });
    const commits = second.getCommits(repo);
    expect(commits).toHaveLength(3);
  });

  it('supports linked worktrees where .git is a file', () => {
    const worktreePath = join(tmpRoot, 'worktree');
    execFileSync(
      'git',
      ['worktree', 'add', '-b', 'side', worktreePath],
      { cwd: repo, stdio: 'ignore' },
    );

    const worktreeCacheDir = join(tmpRoot, 'worktree-cache');
    const correlator = new GitCorrelator({ cacheDir: worktreeCacheDir });
    const commits = correlator.getCommits(worktreePath);
    expect(commits).toHaveLength(3);

    // Disk cache should have been written: second fresh correlator reads it back.
    const second = new GitCorrelator({ cacheDir: worktreeCacheDir });
    expect(second.getCommits(worktreePath)).toHaveLength(3);
  });
});
