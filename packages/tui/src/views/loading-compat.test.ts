import { describe, test, expect } from 'bun:test';
import { renderProgressBar } from './loading-compat';

describe('renderProgressBar', () => {
  test('contains spinner character', () => {
    const bar = renderProgressBar(0, 60, 0);
    expect(bar).toContain('⠋');
  });

  test('shows elapsed time', () => {
    const bar = renderProgressBar(0, 60, 5);
    expect(bar).toContain('5s');
  });

  test('changes spinner on different frames', () => {
    const bar0 = renderProgressBar(0, 60, 0);
    const bar1 = renderProgressBar(1, 60, 0);
    // Different spinner characters
    expect(bar0).not.toBe(bar1);
  });

  test('contains working text', () => {
    const bar = renderProgressBar(0, 60, 0);
    expect(bar).toContain('Working...');
  });
});
