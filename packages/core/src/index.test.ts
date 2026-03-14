import { describe, expect, it } from 'bun:test';
import { VERSION } from './index';

describe('core', () => {
  it('exports a version string', () => {
    expect(VERSION).toBe('1.0.2');
  });

  it('version is a valid semver format', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
