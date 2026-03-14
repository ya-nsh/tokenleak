import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import { startTabbedDashboard } from './tabbed-dashboard';

const COLORS: ProviderColors = {
  primary: '#000000',
  secondary: '#111111',
  gradient: ['#000000', '#111111'],
};

function createProviderData(name: string): ProviderData {
  return {
    provider: name,
    displayName: name,
    daily: [],
    totalTokens: 0,
    totalCost: 0,
    colors: COLORS,
    events: [],
  };
}

describe('startTabbedDashboard', () => {
  let writes: string[];
  let keypressHandler: ((input: string, key: { name?: string; sequence?: string }) => void) | null;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStdoutOn: typeof process.stdout.on;
  let originalStdoutOff: typeof process.stdout.off;
  let originalStdinOn: typeof process.stdin.on;
  let originalStdinOff: typeof process.stdin.off;
  let originalStdinResume: typeof process.stdin.resume;
  let originalStdinPause: typeof process.stdin.pause;
  let originalSetRawMode: typeof process.stdin.setRawMode;
  let stdoutColumnsDescriptor: PropertyDescriptor | undefined;
  let stdoutRowsDescriptor: PropertyDescriptor | undefined;
  let stdinIsTTYDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    writes = [];
    keypressHandler = null;
    originalStdoutWrite = process.stdout.write;
    originalStdoutOn = process.stdout.on;
    originalStdoutOff = process.stdout.off;
    originalStdinOn = process.stdin.on;
    originalStdinOff = process.stdin.off;
    originalStdinResume = process.stdin.resume;
    originalStdinPause = process.stdin.pause;
    originalSetRawMode = process.stdin.setRawMode;
    stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    stdoutRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stdout.on = ((_event: string, _handler: (...args: unknown[]) => void) => {
      return process.stdout;
    }) as typeof process.stdout.on;
    process.stdout.off = ((_event: string, _handler: (...args: unknown[]) => void) => {
      return process.stdout;
    }) as typeof process.stdout.off;
    process.stdin.on = ((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'keypress') {
        keypressHandler = handler as (input: string, key: { name?: string; sequence?: string }) => void;
      }
      return process.stdin;
    }) as typeof process.stdin.on;
    process.stdin.off = ((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'keypress' && keypressHandler === handler) {
        keypressHandler = null;
      }
      return process.stdin;
    }) as typeof process.stdin.off;
    process.stdin.resume = (() => process.stdin) as typeof process.stdin.resume;
    process.stdin.pause = (() => process.stdin) as typeof process.stdin.pause;
    process.stdin.setRawMode = (() => process.stdin) as typeof process.stdin.setRawMode;

    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 24 });
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stdout.on = originalStdoutOn;
    process.stdout.off = originalStdoutOff;
    process.stdin.on = originalStdinOn;
    process.stdin.off = originalStdinOff;
    process.stdin.resume = originalStdinResume;
    process.stdin.pause = originalStdinPause;
    process.stdin.setRawMode = originalSetRawMode;

    if (stdoutColumnsDescriptor) {
      Object.defineProperty(process.stdout, 'columns', stdoutColumnsDescriptor);
    }
    if (stdoutRowsDescriptor) {
      Object.defineProperty(process.stdout, 'rows', stdoutRowsDescriptor);
    }
    if (stdinIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor);
    }
  });

  it('ignores stale range loads when the user switches ranges quickly', async () => {
    const provider: IProvider = {
      name: 'claude-code',
      displayName: 'Claude Code',
      colors: COLORS,
      async isAvailable() {
        return true;
      },
      async load(range: DateRange): Promise<ProviderData> {
        const delay = range.since === '2026-03-07'
          ? 30
          : range.since === '2025-03-14'
            ? 5
            : 1;
        await Bun.sleep(delay);
        return createProviderData('claude-code');
      },
    };

    const dashboardPromise = startTabbedDashboard([provider], {
      initialTimeRange: '30d',
      noColor: true,
      until: '2026-03-14',
    });

    await Bun.sleep(10);
    expect(keypressHandler).not.toBeNull();

    keypressHandler!('', { name: 'left', sequence: '\u001b[D' });
    keypressHandler!('', { name: 'left', sequence: '\u001b[D' });

    await Bun.sleep(50);
    keypressHandler!('', { name: 'q', sequence: 'q' });
    await dashboardPromise;

    const screens = writes.filter((chunk) => chunk.includes('\x1b[H\x1b[J'));
    const lastScreen = screens.at(-1) ?? '';
    expect(lastScreen).toContain('2025-03-14 → 2026-03-14');
    expect(lastScreen).not.toContain('2026-03-07 → 2026-03-14');
  });

  it('ignores stale load failures after the user has already switched again', async () => {
    const provider: IProvider = {
      name: 'claude-code',
      displayName: 'Claude Code',
      colors: COLORS,
      async isAvailable() {
        return true;
      },
      async load(range: DateRange): Promise<ProviderData> {
        if (range.since === '2026-03-07') {
          await Bun.sleep(30);
          throw new Error('stale failure');
        }
        if (range.since === '2025-03-14') {
          await Bun.sleep(5);
        }
        return createProviderData('claude-code');
      },
    };

    const dashboardPromise = startTabbedDashboard([provider], {
      initialTimeRange: '30d',
      noColor: true,
      until: '2026-03-14',
    });

    await Bun.sleep(10);
    expect(keypressHandler).not.toBeNull();

    keypressHandler!('', { name: 'left', sequence: '\u001b[D' });
    keypressHandler!('', { name: 'left', sequence: '\u001b[D' });

    await Bun.sleep(50);
    keypressHandler!('', { name: 'q', sequence: 'q' });

    await expect(dashboardPromise).resolves.toBeUndefined();
    const screens = writes.filter((chunk) => chunk.includes('\x1b[H\x1b[J'));
    const lastScreen = screens.at(-1) ?? '';
    expect(lastScreen).toContain('2025-03-14 → 2026-03-14');
  });
});
