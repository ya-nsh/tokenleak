import { describe, test, expect } from 'bun:test';
import {
  INTERACTIVE_FLAG_LINES,
  getMenuOptionsMeta,
  PROVIDER_CHOICES,
  buildDashboardCommand,
  buildJsonCommand,
  buildImageCommand,
  buildWrappedCommand,
  buildCompareCommand,
  buildExplainCommand,
  buildFocusCommand,
  buildLiveCommand,
  buildListProvidersCommand,
  buildWrappedLiveCommand,
} from './options';

describe('INTERACTIVE_FLAG_LINES', () => {
  test('includes key flags', () => {
    expect(INTERACTIVE_FLAG_LINES).toContain('    explain <date>       explain one day of usage');
    expect(INTERACTIVE_FLAG_LINES).toContain('    focus                rank deep-work sessions');
  });
});

describe('getMenuOptionsMeta', () => {
  test('returns 10 menu options', () => {
    const meta = getMenuOptionsMeta();
    expect(meta).toHaveLength(10);
  });

  test('has unique shortcuts', () => {
    const meta = getMenuOptionsMeta();
    const shortcuts = meta.map((m) => m.shortcut);
    expect(new Set(shortcuts).size).toBe(10);
  });

  test('includes all expected titles', () => {
    const meta = getMenuOptionsMeta();
    const titles = meta.map((m) => m.title);
    expect(titles).toContain('Launch Dashboard');
    expect(titles).toContain('Export');
    expect(titles).toContain('Focus Sessions');
    expect(titles).toContain('Build Custom Command');
  });
});

describe('PROVIDER_CHOICES', () => {
  test('includes all 4 providers', () => {
    expect(PROVIDER_CHOICES).toHaveLength(4);
    const values = PROVIDER_CHOICES.map((c) => c.value);
    expect(values).toContain('claude-code');
    expect(values).toContain('codex');
  });
});

describe('buildDashboardCommand', () => {
  test('returns tabbed-dashboard type', () => {
    const cmd = buildDashboardCommand({ days: 30 }, [], null, false, false);
    expect(cmd.type).toBe('tabbed-dashboard');
  });

  test('passes provider names', () => {
    const cmd = buildDashboardCommand({}, ['claude-code'], null, false, false);
    expect(cmd.type).toBe('tabbed-dashboard');
    if (cmd.type === 'tabbed-dashboard') {
      expect(cmd.options.providerNames).toEqual(['claude-code']);
    }
  });
});

describe('buildJsonCommand', () => {
  test('returns run command with json format', () => {
    const cmd = buildJsonCommand({ days: 30 }, [], null, null, false);
    expect(cmd.type).toBe('run');
    if (cmd.type === 'run') {
      expect(cmd.request.args['format']).toBe('json');
    }
  });
});

describe('buildImageCommand', () => {
  test('returns run command with svg format', () => {
    const cmd = buildImageCommand('svg', 'dark', { days: 30 }, [], null, 'out.svg', false, false);
    expect(cmd.type).toBe('run');
    if (cmd.type === 'run') {
      expect(cmd.request.args['format']).toBe('svg');
      expect(cmd.request.args['theme']).toBe('dark');
    }
  });
});

describe('buildWrappedCommand', () => {
  test('returns wrapped format', () => {
    const cmd = buildWrappedCommand('dark', {}, [], 'out.png', true);
    expect(cmd.type).toBe('run');
    if (cmd.type === 'run') {
      expect(cmd.request.args['format']).toBe('wrapped');
    }
  });
});

describe('buildCompareCommand', () => {
  test('includes compare arg', () => {
    const cmd = buildCompareCommand({}, [], 'auto', null);
    if (cmd.type === 'run') {
      expect(cmd.request.args['compare']).toBe('auto');
    }
  });
});

describe('buildExplainCommand', () => {
  test('creates subcommand with explain', () => {
    const cmd = buildExplainCommand('2026-03-10', 'terminal', [], null, null, false);
    if (cmd.type === 'run') {
      expect(cmd.request.args['subcommand']).toBe('explain');
      expect(cmd.request.title).toBe('Explain Day');
    }
  });
});

describe('buildFocusCommand', () => {
  test('creates subcommand with focus', () => {
    const cmd = buildFocusCommand('terminal', {}, [], null, null, false);
    if (cmd.type === 'run') {
      expect(cmd.request.args['subcommand']).toBe('focus');
      expect(cmd.request.title).toBe('Focus Sessions');
    }
  });
});

describe('buildLiveCommand', () => {
  test('sets inherit execution mode', () => {
    const cmd = buildLiveCommand('dark', {}, [], false);
    if (cmd.type === 'run') {
      expect(cmd.request.executionMode).toBe('inherit');
    }
  });
});

describe('buildWrappedLiveCommand', () => {
  test('sets wrappedLive flag', () => {
    const cmd = buildWrappedLiveCommand({}, []);
    if (cmd.type === 'run') {
      expect(cmd.request.args['wrappedLive']).toBe(true);
    }
  });
});

describe('buildListProvidersCommand', () => {
  test('sets listProviders flag', () => {
    const cmd = buildListProvidersCommand();
    if (cmd.type === 'run') {
      expect(cmd.request.args['listProviders']).toBe(true);
    }
  });
});
