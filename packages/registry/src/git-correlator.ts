import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_CACHE_DIR = join(homedir(), '.config', 'tokenleak', 'git-cache');
const SHIP_WINDOW_MS = 24 * 60 * 60 * 1_000;
const CACHE_KEY_LENGTH = 16;
const GIT_LOG_MAX_BUFFER = 64 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const GIT_QUICK_TIMEOUT_MS = 5_000;

export interface GitCommit {
  sha: string;
  /** Unix ms, UTC. */
  timestamp: number;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface SessionLike {
  /** ISO timestamp. */
  start: string;
  /** ISO timestamp. */
  end: string;
  /** Absolute filesystem path to a repo root (directory containing `.git`). */
  repoRoot: string;
}

export interface ShipStatus {
  shipped: boolean;
  /** SHAs of commits that landed within the ship window. */
  commits: string[];
  /** Insertions + deletions across matched commits. */
  linesChanged: number;
}

export interface GitCorrelatorOptions {
  cacheDir?: string;
  /** Grace window after session end during which a commit still counts as "shipping" the session. */
  shipWindowMs?: number;
}

interface DiskCache {
  repoRoot: string;
  headMtimeMs: number;
  commits: GitCommit[];
}

/**
 * Reads local git history for the repos that appear in UsageEvent.repoRoot and
 * answers two questions per session: did it ship, and with how many lines changed.
 *
 * Stays 100% local: only invokes the `git` binary on directories the user already has.
 * Caches per-repo results both in memory and on disk (keyed by .git/logs/HEAD mtime).
 */
export class GitCorrelator {
  private readonly memCache = new Map<string, GitCommit[]>();
  private readonly cacheDir: string;
  private readonly shipWindowMs: number;

  constructor(options: GitCorrelatorOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.shipWindowMs = options.shipWindowMs ?? SHIP_WINDOW_MS;
  }

  /** Returns all commits for a repo, empty array if the path isn't a git repo. */
  getCommits(repoRoot: string): GitCommit[] {
    if (!isGitRepo(repoRoot)) return [];

    const inMem = this.memCache.get(repoRoot);
    if (inMem) return inMem;

    const disk = this.readDiskCache(repoRoot);
    if (disk) {
      this.memCache.set(repoRoot, disk);
      return disk;
    }

    const fresh = loadCommitsFromGit(repoRoot);
    this.memCache.set(repoRoot, fresh);
    this.writeDiskCache(repoRoot, fresh);
    return fresh;
  }

  /** Commits whose timestamp falls within [startMs, endMs]. */
  commitsInRange(repoRoot: string, startMs: number, endMs: number): GitCommit[] {
    const commits = this.getCommits(repoRoot);
    const out: GitCommit[] = [];
    for (const c of commits) {
      if (c.timestamp >= startMs && c.timestamp <= endMs) out.push(c);
    }
    return out;
  }

  /**
   * A session "ships" if ≥1 commit in its repo lands between the session's start
   * and end + shipWindowMs (default 24h).
   */
  didSessionShip(session: SessionLike): ShipStatus {
    const start = Date.parse(session.start);
    const end = Date.parse(session.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { shipped: false, commits: [], linesChanged: 0 };
    }

    const matched = this.commitsInRange(session.repoRoot, start, end + this.shipWindowMs);
    if (matched.length === 0) {
      return { shipped: false, commits: [], linesChanged: 0 };
    }

    let linesChanged = 0;
    const shas: string[] = [];
    for (const c of matched) {
      linesChanged += c.insertions + c.deletions;
      shas.push(c.sha);
    }
    return { shipped: true, commits: shas, linesChanged };
  }

  private readDiskCache(repoRoot: string): GitCommit[] | null {
    const cachePath = this.diskCachePath(repoRoot);
    if (!existsSync(cachePath)) return null;

    const headMtimeMs = headLogMtime(repoRoot);
    if (headMtimeMs === null) return null;

    try {
      const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as DiskCache;
      if (parsed.repoRoot !== repoRoot) return null;
      if (parsed.headMtimeMs !== headMtimeMs) return null;
      return parsed.commits;
    } catch {
      return null;
    }
  }

  private writeDiskCache(repoRoot: string, commits: GitCommit[]): void {
    try {
      if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true });
      const headMtimeMs = headLogMtime(repoRoot);
      if (headMtimeMs === null) return;
      const payload: DiskCache = { repoRoot, headMtimeMs, commits };
      writeFileSync(this.diskCachePath(repoRoot), JSON.stringify(payload));
    } catch {
      // cache is an optimization; swallow errors
    }
  }

  private diskCachePath(repoRoot: string): string {
    const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, CACHE_KEY_LENGTH);
    return join(this.cacheDir, `${hash}.json`);
  }
}

function isGitRepo(repoRoot: string): boolean {
  if (!repoRoot) return false;
  return existsSync(join(repoRoot, '.git'));
}

/**
 * Resolves a path inside the repo's real gitdir. `.git` may be a file (worktrees,
 * submodules) rather than a directory, so `join(repoRoot, '.git', ...)` is wrong
 * in the general case. `git rev-parse --git-path` handles both.
 */
function resolveGitPath(repoRoot: string, relative: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--git-path', relative],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_QUICK_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    ).trim();
    if (!out) return null;
    return isAbsolute(out) ? out : join(repoRoot, out);
  } catch {
    return null;
  }
}

function headLogMtime(repoRoot: string): number | null {
  const headPath = resolveGitPath(repoRoot, 'logs/HEAD');
  if (!headPath || !existsSync(headPath)) return null;
  try {
    return statSync(headPath).mtimeMs;
  } catch {
    return null;
  }
}

function loadCommitsFromGit(repoRoot: string): GitCommit[] {
  try {
    // `--branches` covers local branches only. Using `--all` would include
    // remote-tracking refs, which change on `git fetch` without touching
    // `logs/HEAD` — so cache invalidation would lag behind the query scope.
    // Local branches are also the right semantic scope for "did this session
    // ship?" attribution: remote commits the user didn't author don't count.
    const raw = execFileSync(
      'git',
      [
        '-C', repoRoot,
        'log',
        '--branches',
        '--no-merges',
        '--format=%x00%H%x01%ct%x01%s',
        '--shortstat',
      ],
      {
        encoding: 'utf8',
        maxBuffer: GIT_LOG_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    );
    return parseGitLog(raw);
  } catch {
    return [];
  }
}

const SHORTSTAT_RE = /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

/**
 * Parses `git log --format=%x00%H%x01%ct%x01%s --shortstat` output.
 * Exported for unit testing without spawning git.
 */
export function parseGitLog(raw: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const entries = raw.split('\x00');

  for (const entry of entries) {
    if (entry.length === 0) continue;

    const [header, ...rest] = entry.split('\n');
    const statLine = rest.find((line) => SHORTSTAT_RE.test(line)) ?? '';
    const [sha, ctimeStr, ...subjectParts] = header.split('\x01');
    if (!sha || !ctimeStr) continue;

    const ctime = Number(ctimeStr);
    if (!Number.isFinite(ctime)) continue;

    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    const m = statLine.match(SHORTSTAT_RE);
    if (m) {
      filesChanged = Number(m[1]) || 0;
      insertions = Number(m[2] ?? '0') || 0;
      deletions = Number(m[3] ?? '0') || 0;
    }

    commits.push({
      sha,
      timestamp: ctime * 1000,
      subject: subjectParts.join('\x01'),
      filesChanged,
      insertions,
      deletions,
    });
  }

  return commits;
}
