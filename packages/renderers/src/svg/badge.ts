import type { AggregatedStats } from '@tokenleak/core';
import { escapeXml } from './utils';

const BADGE_HEIGHT = 20;
const LABEL_TEXT = 'streak';
const FONT_SIZE = 11;
const FONT_FAMILY = 'Verdana,Geneva,DejaVu Sans,sans-serif';
const LABEL_WIDTH = 46;
const VALUE_PADDING = 12;

/**
 * Render a small shields.io-style SVG badge showing the current streak count.
 * Includes a prefers-color-scheme media query for dark/light mode support.
 */
export function renderBadge(stats: AggregatedStats): string {
  const valueText = `${stats.currentStreak} days`;
  // Estimate value width based on character count (monospace-ish)
  const valueWidth = valueText.length * 7 + VALUE_PADDING;
  const totalWidth = LABEL_WIDTH + valueWidth;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${BADGE_HEIGHT}" viewBox="0 0 ${totalWidth} ${BADGE_HEIGHT}">`,
    '<style>',
    '  @media (prefers-color-scheme: dark) {',
    '    .badge-label { fill: #555 }',
    '    .badge-value { fill: #4c1 }',
    '    .badge-shadow { fill: #010101; fill-opacity: .3 }',
    '    .badge-text { fill: #fff }',
    '  }',
    '  @media (prefers-color-scheme: light) {',
    '    .badge-label { fill: #555 }',
    '    .badge-value { fill: #97ca00 }',
    '    .badge-shadow { fill: #010101; fill-opacity: .3 }',
    '    .badge-text { fill: #fff }',
    '  }',
    '</style>',
    `<rect class="badge-label" width="${LABEL_WIDTH}" height="${BADGE_HEIGHT}" rx="3"/>`,
    `<rect class="badge-value" x="${LABEL_WIDTH}" width="${valueWidth}" height="${BADGE_HEIGHT}" rx="3"/>`,
    `<rect x="${LABEL_WIDTH}" width="4" height="${BADGE_HEIGHT}"/>`,
    '<g text-anchor="middle">',
    `  <text class="badge-shadow" x="${LABEL_WIDTH / 2}" y="${BADGE_HEIGHT - 5}" font-family="${escapeXml(FONT_FAMILY)}" font-size="${FONT_SIZE}">${escapeXml(LABEL_TEXT)}</text>`,
    `  <text class="badge-text" x="${LABEL_WIDTH / 2}" y="${BADGE_HEIGHT - 6}" font-family="${escapeXml(FONT_FAMILY)}" font-size="${FONT_SIZE}">${escapeXml(LABEL_TEXT)}</text>`,
    `  <text class="badge-shadow" x="${LABEL_WIDTH + valueWidth / 2}" y="${BADGE_HEIGHT - 5}" font-family="${escapeXml(FONT_FAMILY)}" font-size="${FONT_SIZE}">${escapeXml(valueText)}</text>`,
    `  <text class="badge-text" x="${LABEL_WIDTH + valueWidth / 2}" y="${BADGE_HEIGHT - 6}" font-family="${escapeXml(FONT_FAMILY)}" font-size="${FONT_SIZE}">${escapeXml(valueText)}</text>`,
    '</g>',
    '</svg>',
  ].join('\n');
}
