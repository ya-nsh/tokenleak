import { describe, expect, it } from 'bun:test';
import { renderWrappedPng } from '../wrapped-card';
import { renderWrappedSlidesSvg, computeAchievements } from '../../svg/wrapped-slides';
import {
  createOutput,
  createPopulatedStats,
  createProvider,
  createMoreStats,
  createZeroedStats,
} from '../../__test-fixtures__';

/** PNG magic bytes: 0x89 P N G */
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

// ── PNG rendering tests ──────────────────────────────────────────────
describe('renderWrappedPng', () => {
  it('output starts with PNG magic bytes (dark theme)', async () => {
    const result = await renderWrappedPng(createOutput(), { theme: 'dark' });
    const buffer = Buffer.from(result);
    expect(buffer[0]).toBe(PNG_MAGIC_BYTES[0]);
    expect(buffer[1]).toBe(PNG_MAGIC_BYTES[1]);
    expect(buffer[2]).toBe(PNG_MAGIC_BYTES[2]);
    expect(buffer[3]).toBe(PNG_MAGIC_BYTES[3]);
  });

  it('output starts with PNG magic bytes (light theme)', async () => {
    const result = await renderWrappedPng(createOutput(), { theme: 'light' });
    const buffer = Buffer.from(result);
    expect(buffer[0]).toBe(PNG_MAGIC_BYTES[0]);
    expect(buffer[1]).toBe(PNG_MAGIC_BYTES[1]);
    expect(buffer[2]).toBe(PNG_MAGIC_BYTES[2]);
    expect(buffer[3]).toBe(PNG_MAGIC_BYTES[3]);
  });

  it('output buffer has non-zero length', async () => {
    const result = await renderWrappedPng(createOutput(), { theme: 'dark' });
    expect(result.length).toBeGreaterThan(0);
  });

  it('dark vs light theme produces different buffers', async () => {
    const output = createOutput();
    const darkBuffer = await renderWrappedPng(output, { theme: 'dark' });
    const lightBuffer = await renderWrappedPng(output, { theme: 'light' });

    const darkHex = Buffer.from(darkBuffer).toString('hex').slice(0, 200);
    const lightHex = Buffer.from(lightBuffer).toString('hex').slice(0, 200);
    expect(darkHex).not.toBe(lightHex);
  });

  it('returns a Buffer instance', async () => {
    const result = await renderWrappedPng(createOutput(), { theme: 'dark' });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('renders with populated stats and more data', async () => {
    const output = createOutput({
      more: createMoreStats(),
    });
    const result = await renderWrappedPng(output, { theme: 'dark' });
    const buffer = Buffer.from(result);
    expect(buffer[0]).toBe(PNG_MAGIC_BYTES[0]);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('renders with zeroed stats without crashing', async () => {
    const output = createOutput({
      aggregated: createZeroedStats(),
      providers: [],
      more: null,
    });
    const result = await renderWrappedPng(output, { theme: 'dark' });
    const buffer = Buffer.from(result);
    expect(buffer[0]).toBe(PNG_MAGIC_BYTES[0]);
  });

  it('renders with single provider', async () => {
    const output = createOutput({
      providers: [createProvider('claude-code', 'Claude Code')],
    });
    const result = await renderWrappedPng(output, { theme: 'dark' });
    expect(Buffer.from(result)[0]).toBe(PNG_MAGIC_BYTES[0]);
  });

  it('renders with multiple providers', async () => {
    const output = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
        createProvider('pi', 'Pi'),
      ],
    });
    const result = await renderWrappedPng(output, { theme: 'dark' });
    expect(Buffer.from(result)[0]).toBe(PNG_MAGIC_BYTES[0]);
  });
});

// ── SVG output tests ─────────────────────────────────────────────────
describe('renderWrappedSlidesSvg', () => {
  it('produces valid SVG with opening and closing tags', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('has width 1200', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('width="1200"');
  });

  it('includes title text', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('Your AI Coding');
    expect(svg).toContain('Wrapped');
  });

  it('includes date range', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('2026');
  });

  it('includes tokenleak watermark', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('tokenleak');
  });

  it('includes streak section', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('STREAK STORY');
  });

  it('includes big numbers section', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('THE BIG NUMBERS');
  });

  it('includes cache section', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('CACHE EFFICIENCY');
  });

  it('includes achievements section', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('ACHIEVEMENTS');
  });

  it('includes provider data', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('PROVIDER MIX');
  });

  it('includes day of week section', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('CODING DAYS');
  });

  it('includes monthly projection section', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('MONTHLY PROJECTION');
  });

  it('includes peak day section', () => {
    const svg = renderWrappedSlidesSvg(createOutput(), { theme: 'dark' });
    expect(svg).toContain('PEAK DAY');
  });

  it('dark vs light theme produces different SVG', () => {
    const output = createOutput();
    const dark = renderWrappedSlidesSvg(output, { theme: 'dark' });
    const light = renderWrappedSlidesSvg(output, { theme: 'light' });
    expect(dark).not.toBe(light);
  });

  it('handles empty providers gracefully', () => {
    const output = createOutput({
      providers: [],
      aggregated: createZeroedStats(),
    });
    const svg = renderWrappedSlidesSvg(output, { theme: 'dark' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('includes time-of-day section when more stats present', () => {
    const output = createOutput({ more: createMoreStats() });
    const svg = renderWrappedSlidesSvg(output, { theme: 'dark' });
    expect(svg).toContain('WHEN YOU CODE');
  });

  it('skips time-of-day section when no more stats', () => {
    const output = createOutput({ more: null });
    const svg = renderWrappedSlidesSvg(output, { theme: 'dark' });
    expect(svg).not.toContain('WHEN YOU CODE');
  });
});

// ── Achievement computation tests ────────────────────────────────────
describe('computeAchievements', () => {
  it('returns at least 3 achievements for basic stats', () => {
    const output = createOutput();
    const achievements = computeAchievements(output);
    expect(achievements.length).toBeGreaterThanOrEqual(3);
  });

  it('returns at most 6 achievements', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({
        longestStreak: 45,
        totalCost: 200,
        cacheHitRate: 0.8,
        topModels: [
          { model: 'a', tokens: 1000, cost: 1, percentage: 25 },
          { model: 'b', tokens: 1000, cost: 1, percentage: 25 },
          { model: 'c', tokens: 1000, cost: 1, percentage: 25 },
          { model: 'd', tokens: 1000, cost: 1, percentage: 25 },
        ],
        averageDailyTokens: 20000,
        activeDays: 35,
        totalDays: 40,
        peakDay: { date: '2026-03-01', tokens: 80000 },
      }),
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
        createProvider('pi', 'Pi'),
      ],
      more: createMoreStats({
        hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          tokens: hour >= 18 ? 5000 : 500,
          cost: 0.1,
          count: 1,
        })),
      }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.length).toBeLessThanOrEqual(6);
  });

  it('awards Streak Master for streak > 30', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ longestStreak: 45 }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Streak Master')).toBe(true);
  });

  it('does not award Streak Master for streak <= 30', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ longestStreak: 20 }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Streak Master')).toBe(false);
  });

  it('awards Big Spender for cost > $100', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ totalCost: 150 }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Big Spender')).toBe(true);
  });

  it('awards Cache Master for hit rate > 50%', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ cacheHitRate: 0.65 }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Cache Master')).toBe(true);
  });

  it('does not award Cache Master for hit rate <= 50%', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ cacheHitRate: 0.3 }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Cache Master')).toBe(false);
  });

  it('awards Model Hopper for 4+ models', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({
        topModels: [
          { model: 'a', tokens: 1000, cost: 1, percentage: 25 },
          { model: 'b', tokens: 1000, cost: 1, percentage: 25 },
          { model: 'c', tokens: 1000, cost: 1, percentage: 25 },
          { model: 'd', tokens: 1000, cost: 1, percentage: 25 },
        ],
      }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Model Hopper')).toBe(true);
  });

  it('awards Daily Driver for active > 80% of days', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ activeDays: 35, totalDays: 40 }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Daily Driver')).toBe(true);
  });

  it('awards Power User for avg daily > 10000', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({ averageDailyTokens: 15000 }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Power User')).toBe(true);
  });

  it('awards Summit Day for peak > 50000 tokens', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({
        peakDay: { date: '2026-03-01', tokens: 80000 },
      }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Summit Day')).toBe(true);
  });

  it('awards Multi-Tool for 3+ providers', () => {
    const output = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
        createProvider('pi', 'Pi'),
      ],
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Multi-Tool')).toBe(true);
  });

  it('awards Night Owl for >40% usage after 6pm', () => {
    const output = createOutput({
      more: createMoreStats({
        hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          tokens: hour >= 18 ? 5000 : 500,
          cost: 0.1,
          count: 1,
        })),
      }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Night Owl')).toBe(true);
  });

  it('awards Early Bird for >40% usage before noon', () => {
    const output = createOutput({
      more: createMoreStats({
        hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          tokens: hour < 12 ? 5000 : 500,
          cost: 0.1,
          count: 1,
        })),
      }),
    });
    const achievements = computeAchievements(output);
    expect(achievements.some((a) => a.title === 'Early Bird')).toBe(true);
  });

  it('provides fallback achievements for zeroed stats', () => {
    const output = createOutput({
      aggregated: createZeroedStats(),
      providers: [],
      more: null,
    });
    const achievements = computeAchievements(output);
    expect(achievements.length).toBeGreaterThanOrEqual(1);
  });

  it('each achievement has icon, title, subtitle, and color', () => {
    const output = createOutput();
    const achievements = computeAchievements(output);
    for (const a of achievements) {
      expect(a.icon).toBeTruthy();
      expect(a.title).toBeTruthy();
      expect(a.subtitle).toBeTruthy();
      expect(a.color).toBeTruthy();
    }
  });
});
