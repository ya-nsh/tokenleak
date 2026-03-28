import { describe, expect, it } from 'bun:test';
import { buildAppPlist, buildClaudeStatuslineWrapper, buildDashboardWrapper } from './launchd';
import { resolveMenubarPaths } from './paths';

describe('menubar launchd and wrapper generation', () => {
  const paths = resolveMenubarPaths('/tmp/tokenleak-home');

  it('builds an app plist for the menubar app', () => {
    const plist = buildAppPlist(paths);
    expect(plist).toContain('com.tokenleak.menubar');
    expect(plist).toContain('Tokenleak Usage');
    expect(plist).toContain('TOKENLEAK_MENUBAR_HOME');
  });

  it('builds a dashboard wrapper pinned to codex and claude-code', () => {
    const wrapper = buildDashboardWrapper(paths);
    expect(wrapper).toContain('--provider codex,claude-code');
  });

  it('builds a Claude statusline wrapper that records bridge snapshots', () => {
    const wrapper = buildClaudeStatuslineWrapper(paths);
    expect(wrapper).toContain('menubar claude-statusline');
    expect(wrapper).toContain('claude-statusline-original');
  });
});
