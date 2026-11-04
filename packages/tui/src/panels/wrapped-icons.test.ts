import { describe, expect, test } from 'bun:test';
import { ACHIEVEMENT_ICONS } from './wrapped';

/** Cells a default-emoji code point takes in a terminal. */
const WIDE_CELLS = 2;
const VARIATION_SELECTOR_16 = '️';

describe('ACHIEVEMENT_ICONS', () => {
  const entries = Object.entries(ACHIEVEMENT_ICONS);

  test('has an icon for every achievement the stats can award', () => {
    // Icon keys `computeAchievements` in @tokenleak/renderers can return.
    const awarded = ['bolt', 'calendar', 'circle', 'diamond', 'fire', 'moon', 'mountain', 'palette', 'rocket', 'star', 'sun', 'target'];
    for (const key of awarded) expect(ACHIEVEMENT_ICONS[key]).toBeDefined();
  });

  test.each(entries)('%s is one default-emoji code point', (_name, icon) => {
    expect([...icon]).toHaveLength(1);
    expect(icon).not.toContain(VARIATION_SELECTOR_16);
    expect(/^\p{Emoji_Presentation}$/u.test(icon)).toBe(true);
  });

  test.each(entries)('%s takes two terminal cells', (_name, icon) => {
    expect(Bun.stringWidth(icon)).toBe(WIDE_CELLS);
  });

  test('rejects the selector-based symbols this replaced', () => {
    // Guards the check itself: these were the icons that broke row alignment.
    for (const old of ['⛰️', '☀️']) {
      expect(/^\p{Emoji_Presentation}$/u.test(old)).toBe(false);
    }
  });
});
