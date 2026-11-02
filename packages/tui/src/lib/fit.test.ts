import { describe, expect, test } from 'bun:test';
import { fitHints, fitTabWindow, tabWidth } from './fit';

const VIEWS = ['Overview', 'Quotas', 'Matrix', 'Advisor', 'Focus', 'Explain', 'Compare', 'Export'];

describe('fitTabWindow', () => {
  test('shows every tab when they fit', () => {
    const total = VIEWS.reduce((sum, label) => sum + tabWidth(label), 0);
    expect(fitTabWindow(VIEWS, 3, total)).toEqual({ start: 0, end: VIEWS.length });
  });

  test('keeps the active tab visible and centered when space is short', () => {
    const window = fitTabWindow(VIEWS, 4, 30);
    expect(window.start).toBeLessThanOrEqual(4);
    expect(window.end).toBeGreaterThan(4);
    expect(window.start).toBeGreaterThan(0);
    expect(window.end).toBeLessThan(VIEWS.length);
  });

  test('never exceeds the budget, counting overflow markers', () => {
    for (let budget = 12; budget <= 80; budget++) {
      for (let active = 0; active < VIEWS.length; active++) {
        const { start, end } = fitTabWindow(VIEWS, active, budget);
        let width = VIEWS.slice(start, end).reduce((sum, label) => sum + tabWidth(label), 0);
        if (start > 0) width += 2;
        if (end < VIEWS.length) width += 2;
        expect(end - start === 1 || width <= budget).toBe(true);
      }
    }
  });

  test('always shows at least the active tab, even with no room', () => {
    expect(fitTabWindow(VIEWS, 7, 0)).toEqual({ start: 7, end: 8 });
  });

  test('handles the first and last tab and out-of-range indexes', () => {
    expect(fitTabWindow(VIEWS, 0, 30).start).toBe(0);
    expect(fitTabWindow(VIEWS, 99, 30).end).toBe(VIEWS.length);
    expect(fitTabWindow([], 0, 30)).toEqual({ start: 0, end: 0 });
  });
});

describe('fitHints', () => {
  const hints = [
    { text: '←→:view', priority: 1 },
    { text: 'j/k:scroll', priority: 2 },
    { text: 'c:cursor', priority: 5 },
    { text: '?:keys', priority: 1 },
    { text: 'q:quit', priority: 0 },
  ];

  test('keeps everything when it fits', () => {
    expect(fitHints(hints, 200)).toBe('←→:view  j/k:scroll  c:cursor  ?:keys  q:quit');
  });

  test('drops the least important hints first, preserving order', () => {
    expect(fitHints(hints, 36)).toBe('←→:view  j/k:scroll  ?:keys  q:quit');
    expect(fitHints(hints, 24)).toBe('←→:view  ?:keys  q:quit');
  });

  test('never drops the last remaining hint', () => {
    expect(fitHints(hints, 1)).toBe('q:quit');
  });
});
