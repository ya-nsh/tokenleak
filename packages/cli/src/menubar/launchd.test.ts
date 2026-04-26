import { describe, expect, it } from 'bun:test';
import { buildAppPlist, buildClaudeStatuslineBridge, buildDashboardWrapper } from './launchd';
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

  it('builds a self-contained Claude statusline bridge using python3', () => {
    const bridge = buildClaudeStatuslineBridge(paths);
    expect(bridge).toContain('/usr/bin/python3');
    expect(bridge).toContain('claude-rate-limits.json');
    expect(bridge).toContain('claude-statusline-original');
    // Must NOT spawn the tokenleak CLI binary
    expect(bridge).not.toContain('menubar claude-statusline');
    expect(bridge).not.toContain('tokenleak-menubar-cli');
  });

  it('bridge script extracts rate_limits fields', () => {
    const bridge = buildClaudeStatuslineBridge(paths);
    expect(bridge).toContain('rate_limits');
    expect(bridge).toContain('five_hour');
    expect(bridge).toContain('seven_day');
    expect(bridge).toContain('used_percentage');
    expect(bridge).toContain('resets_at');
  });

  it('bridge script performs atomic write', () => {
    const bridge = buildClaudeStatuslineBridge(paths);
    expect(bridge).toContain('os.rename');
    expect(bridge).toContain('mkstemp');
  });
});
