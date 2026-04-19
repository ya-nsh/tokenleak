import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAttributionClusters,
  buildProjectRollups,
  buildSessionRollups,
  inferDirectoryLabel,
  inferRepoRoot,
  normalizeScores,
} from './analytics';
import type { UsageEvent } from '../types';

const TEMP_DIRS: string[] = [];

const EVENTS: UsageEvent[] = [
  {
    provider: 'claude-code',
    timestamp: '2026-03-01T09:00:00.000Z',
    date: '2026-03-01',
    model: 'claude-sonnet-4',
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheWriteTokens: 50,
    totalTokens: 1550,
    cost: 0.75,
    sessionId: 'session-a',
    projectId: '/Users/test/work/tokenleak/packages/core',
  },
  {
    provider: 'claude-code',
    timestamp: '2026-03-01T09:10:00.000Z',
    date: '2026-03-01',
    model: 'claude-opus-4',
    inputTokens: 200,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 600,
    cost: 0.95,
    sessionId: 'session-a',
    projectId: '/Users/test/work/tokenleak/packages/core',
  },
  {
    provider: 'codex',
    timestamp: '2026-03-02T12:00:00.000Z',
    date: '2026-03-02',
    model: 'gpt-5',
    inputTokens: 500,
    outputTokens: 300,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 800,
    cost: 0.55,
    sessionId: 'session-b',
    projectId: '/Users/test/work/tokenleak/apps/web',
  },
];

describe('analytics helpers', () => {
  it('infers repo roots and directory labels from project paths', () => {
    const repoRoot = inferRepoRoot('/Users/test/work/tokenleak/packages/core');
    expect(repoRoot).toBe('/Users/test/work');
    expect(inferDirectoryLabel('/Users/test/work/tokenleak/packages/core', repoRoot)).toBe('tokenleak');
    expect(inferDirectoryLabel('project-alpha', null)).toBe('project-alpha');
  });

  afterEach(() => {
    while (TEMP_DIRS.length > 0) {
      const dir = TEMP_DIRS.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('prefers an actual git root when one exists on disk', () => {
    const root = join(tmpdir(), `tokenleak-repo-root-${Date.now()}`);
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'packages', 'core'), { recursive: true });
    TEMP_DIRS.push(root);

    expect(inferRepoRoot(join(root, 'packages', 'core'))).toBe(root);
  });

  it('builds session rollups with derived duration and top models', () => {
    const sessions = buildSessionRollups(EVENTS);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.sessionId).toBe('session-a');
    expect(sessions[0]?.totalTokens).toBe(2150);
    expect(sessions[0]?.durationMs).toBe(600000);
    expect(sessions[0]?.topModels[0]?.model).toBe('claude-sonnet-4');
  });

  it('builds project rollups with session counts and streaks', () => {
    const projects = buildProjectRollups(EVENTS);
    expect(projects).toHaveLength(2);
    expect(projects[0]?.projectId).toBe('/Users/test/work/tokenleak/packages/core');
    expect(projects[0]?.sessionCount).toBe(1);
    expect(projects[0]?.activeDays).toBe(1);
    expect(projects[0]?.topSessions[0]?.label).toBe('/Users/test/work/tokenleak/packages/core');
  });

  it('upgrades an existing session when a later event adds project metadata', () => {
    const sessions = buildSessionRollups([
      {
        provider: 'codex',
        timestamp: '2026-03-03T10:00:00.000Z',
        date: '2026-03-03',
        model: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        cost: 0.1,
        sessionId: 'session-upgrade',
      },
      {
        provider: 'codex',
        timestamp: '2026-03-03T10:05:00.000Z',
        date: '2026-03-03',
        model: 'gpt-5',
        inputTokens: 120,
        outputTokens: 60,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 180,
        cost: 0.12,
        sessionId: 'session-upgrade',
        projectId: '/Users/test/work/tokenleak/apps/web',
      },
    ]);

    expect(sessions[0]?.label).toBe('/Users/test/work/tokenleak/apps/web');
    expect(sessions[0]?.projectId).toBe('/Users/test/work/tokenleak/apps/web');
    expect(sessions[0]?.repoRoot).toBe('/Users/test/work');
  });

  it('builds conservative attribution clusters from stable repo and project signals', () => {
    const clusters = buildAttributionClusters([
      {
        provider: 'pi',
        timestamp: '2026-03-03T09:00:00.000Z',
        date: '2026-03-03',
        model: 'gpt-5',
        inputTokens: 400,
        outputTokens: 120,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 520,
        cost: 0.2,
        sessionId: 'session-c',
        projectId: '/Users/test/work/tokenleak/packages/core',
        durationMs: 120000,
      },
      {
        provider: 'claude-code',
        timestamp: '2026-03-03T17:30:00.000Z',
        date: '2026-03-03',
        model: 'claude-sonnet-4',
        inputTokens: 300,
        outputTokens: 100,
        cacheReadTokens: 50,
        cacheWriteTokens: 0,
        totalTokens: 450,
        cost: 0.18,
        sessionId: 'session-d',
        projectId: '/Users/test/work/tokenleak/apps/web',
        durationMs: 180000,
      },
      {
        provider: 'claude-code',
        timestamp: '2026-03-04T09:00:00.000Z',
        date: '2026-03-04',
        model: 'claude-sonnet-4',
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 280,
        cost: 0.12,
        sessionId: 'session-e',
        projectId: 'project-alpha',
      },
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.repoRoot).toBe('/Users/test/work');
    expect(clusters[0]?.directory).toBe('tokenleak');
    expect(clusters[0]?.taskStyle).toBe('quick-hit');
    expect(clusters[0]?.sessionCount).toBe(2);
    expect(clusters[0]?.providers).toEqual(['pi', 'claude-code']);
    expect(clusters[0]?.timeWindows).toHaveLength(2);
    expect(clusters[1]?.taskStyle).toBe('mixed');
    expect(clusters[1]?.repoRoot).toBeNull();
  });

  it('normalizes arbitrary value sets into 0..1 scores', () => {
    expect(normalizeScores([5, 10, 15])).toEqual([0, 0.5, 1]);
    expect(normalizeScores([2, 2])).toEqual([1, 1]);
    expect(normalizeScores([])).toEqual([]);
  });
});
