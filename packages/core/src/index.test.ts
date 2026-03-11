import { describe, expect, it } from 'bun:test';
import { VERSION } from './index';

describe('core', () => {
  it('exports a version string', () => {
    expect(VERSION).toBe('0.4.1');
  });

  it('version is a valid semver format', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
