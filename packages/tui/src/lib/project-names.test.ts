import { describe, expect, test } from 'bun:test';
import { projectDisplayName, sessionDisplayName } from './project-names';

const session = (overrides: Partial<Parameters<typeof sessionDisplayName>[0]> = {}) => ({
  projectId: '/Users/me/work/headroom',
  repoRoot: '/Users/me/work/headroom',
  label: 'Refactor the parser',
  sessionId: 'abc-123',
  ...overrides,
});

describe('sessionDisplayName', () => {
  test('names a session at the repo root after the repo, not "."', () => {
    expect(sessionDisplayName(session())).toBe('headroom');
  });

  test('names a subfolder session as repo/folder', () => {
    expect(sessionDisplayName(session({ projectId: '/Users/me/work/headroom/packages/api' }))).toBe('headroom/api');
  });

  test('names a worktree session as repo@worktree', () => {
    expect(
      sessionDisplayName(session({ projectId: '/Users/me/work/headroom/.claude/worktrees/fix-auth', repoRoot: null })),
    ).toBe('headroom@fix-auth');
  });

  test('falls back to the label without a project', () => {
    expect(sessionDisplayName(session({ projectId: null, repoRoot: null }))).toBe('Refactor the parser');
  });

  test('falls back to the id when the label is blank', () => {
    expect(sessionDisplayName(session({ projectId: '  ', repoRoot: null, label: '   ' }))).toBe('abc-123');
  });
});

describe('projectDisplayName', () => {
  test('names a root project after its repo', () => {
    expect(projectDisplayName({ projectId: '/Users/me/work/loopcraft', repoRoot: '/Users/me/work/loopcraft' })).toBe('loopcraft');
  });

  test('keeps a non-path project id as it is', () => {
    expect(projectDisplayName({ projectId: 'cursor-workspace', repoRoot: null })).toBe('cursor-workspace');
  });
});
