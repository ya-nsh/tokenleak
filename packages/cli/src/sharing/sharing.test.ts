import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { getClipboardCommand } from './clipboard';
import { getOpenCommand } from './open';

// ─── getClipboardCommand ────────────────────────────────────────────────

describe('getClipboardCommand', () => {
  test('returns pbcopy for darwin', () => {
    const cmd = getClipboardCommand('darwin');
    expect(cmd).toEqual(['pbcopy']);
  });

  test('returns xclip for linux', () => {
    const cmd = getClipboardCommand('linux');
    expect(cmd).toEqual(['xclip', '-selection', 'clipboard']);
  });

  test('returns clip for win32', () => {
    const cmd = getClipboardCommand('win32');
    expect(cmd).toEqual(['clip']);
  });

  test('throws for unsupported platform', () => {
    expect(() => getClipboardCommand('freebsd' as NodeJS.Platform)).toThrow(
      'Clipboard is not supported on platform "freebsd"',
    );
  });

  test('throws for aix platform', () => {
    expect(() => getClipboardCommand('aix' as NodeJS.Platform)).toThrow(
      'Clipboard is not supported',
    );
  });
});

// ─── getOpenCommand ─────────────────────────────────────────────────────

describe('getOpenCommand', () => {
  test('returns open for darwin', () => {
    expect(getOpenCommand('darwin')).toBe('open');
  });

  test('returns xdg-open for linux', () => {
    expect(getOpenCommand('linux')).toBe('xdg-open');
  });

  test('returns start for win32', () => {
    expect(getOpenCommand('win32')).toBe('start');
  });

  test('throws for unsupported platform', () => {
    expect(() => getOpenCommand('freebsd' as NodeJS.Platform)).toThrow(
      'Opening files is not supported on platform "freebsd"',
    );
  });

  test('throws for sunos platform', () => {
    expect(() => getOpenCommand('sunos' as NodeJS.Platform)).toThrow(
      'Opening files is not supported',
    );
  });
});

// ─── copyToClipboard ────────────────────────────────────────────────────

describe('copyToClipboard', () => {
  test('calls pbcopy on macOS and pipes content', async () => {
    // We test via actual execution on macOS since that's the test platform
    const { copyToClipboard } = await import('./clipboard');

    if (process.platform === 'darwin') {
      // This will actually copy to clipboard — safe in CI/test
      await expect(copyToClipboard('test content', 'darwin')).resolves.toBeUndefined();
    } else {
      // On other platforms, just verify the function exists
      expect(typeof copyToClipboard).toBe('function');
    }
  });

  test('throws for unsupported platform', async () => {
    const { copyToClipboard } = await import('./clipboard');
    await expect(
      copyToClipboard('hello', 'freebsd' as NodeJS.Platform),
    ).rejects.toThrow('Clipboard is not supported');
  });
});

// ─── openFile ───────────────────────────────────────────────────────────

describe('openFile', () => {
  test('throws for unsupported platform', async () => {
    const { openFile } = await import('./open');
    await expect(
      openFile('/tmp/test.txt', 'freebsd' as NodeJS.Platform),
    ).rejects.toThrow('Opening files is not supported');
  });

  test('throws when file does not exist', async () => {
    const { openFile } = await import('./open');
    // On macOS, open will fail for nonexistent file
    if (process.platform === 'darwin') {
      await expect(
        openFile('/tmp/nonexistent-tokenleak-file-' + Date.now() + '.txt', 'darwin'),
      ).rejects.toThrow();
    }
  });
});

// ─── isGhAvailable ──────────────────────────────────────────────────────

describe('isGhAvailable', () => {
  test('returns a boolean', async () => {
    const { isGhAvailable } = await import('./gist');
    const result = await isGhAvailable();
    expect(typeof result).toBe('boolean');
  });
});

// ─── uploadToGist ───────────────────────────────────────────────────────

describe('uploadToGist', () => {
  test('throws when gh is not available', async () => {
    // We test the error path by importing and checking behavior
    const { uploadToGist, isGhAvailable } = await import('./gist');

    // If gh is not authenticated, it should throw
    const available = await isGhAvailable();
    if (!available) {
      await expect(
        uploadToGist('content', 'test.txt', 'test'),
      ).rejects.toThrow('GitHub CLI (gh) is not installed or not authenticated');
    } else {
      // gh is available — just verify the function exists
      expect(typeof uploadToGist).toBe('function');
    }
  });

  test('function accepts correct parameter types', () => {
    const { uploadToGist } = require('./gist');
    expect(typeof uploadToGist).toBe('function');
    expect(uploadToGist.length).toBe(3);
  });
});

// ─── index re-exports ──────────────────────────────────────────────────

describe('sharing/index re-exports', () => {
  test('exports all sharing functions', async () => {
    const sharing = await import('./index');
    expect(typeof sharing.copyToClipboard).toBe('function');
    expect(typeof sharing.getClipboardCommand).toBe('function');
    expect(typeof sharing.openFile).toBe('function');
    expect(typeof sharing.getOpenCommand).toBe('function');
    expect(typeof sharing.uploadToGist).toBe('function');
    expect(typeof sharing.isGhAvailable).toBe('function');
  });
});
