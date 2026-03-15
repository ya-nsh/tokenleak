import { describe, test, expect } from 'bun:test';
import { getLayoutMode } from './use-layout-mode';

describe('getLayoutMode', () => {
  test('returns narrow for width < 80', () => {
    expect(getLayoutMode(40)).toBe('narrow');
    expect(getLayoutMode(79)).toBe('narrow');
  });

  test('returns balanced for width 80-120', () => {
    expect(getLayoutMode(80)).toBe('balanced');
    expect(getLayoutMode(100)).toBe('balanced');
    expect(getLayoutMode(120)).toBe('balanced');
  });

  test('returns wide for width > 120', () => {
    expect(getLayoutMode(121)).toBe('wide');
    expect(getLayoutMode(200)).toBe('wide');
  });
});
