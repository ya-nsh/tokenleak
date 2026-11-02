import { describe, expect, test } from 'bun:test';
import { describeGitSignal } from './nutrition';

describe('describeGitSignal', () => {
  test('full coverage is good news', () => {
    expect(describeGitSignal(12, 0).tone).toBe('ok');
  });

  test('some repos without commits is partial, never "no commits found"', () => {
    const notice = describeGitSignal(1350, 1);
    expect(notice.tone).toBe('partial');
    expect(notice.headline).toBe('1 repo had AI usage but no commits in this window (marked "No signal").');
    expect(notice.headline).not.toContain('no commits were found');
  });

  test('pluralizes repo counts', () => {
    expect(describeGitSignal(3, 4).headline).toStartWith('4 repos had');
  });

  test('no commits at all keeps the setup guidance', () => {
    const notice = describeGitSignal(0, 2);
    expect(notice.tone).toBe('none');
    expect(notice.detail).toContain('Git checkout');
  });
});
