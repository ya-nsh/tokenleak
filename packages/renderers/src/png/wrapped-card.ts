import type { TokenleakOutput } from '@tokenleak/core';
import { renderWrappedSinglePageSvg } from '../svg/wrapped-single-page';
import sharp from 'sharp';

// 216 DPI gives 2x resolution (2400px wide) — sharp and crisp for social sharing.
const PNG_DENSITY = 216;

/**
 * Render a single-page "AI Coding Wrapped" infographic PNG.
 * The image is 1200px wide with dynamic height based on content.
 */
export async function renderWrappedPng(
  output: TokenleakOutput,
  options: { theme: 'dark' | 'light' },
): Promise<Buffer> {
  // Theme param is accepted for API compatibility but single-page uses dark only
  void options.theme;

  const svgString = renderWrappedSinglePageSvg(output);

  const pngBuffer = await sharp(Buffer.from(svgString), {
    density: PNG_DENSITY,
  })
    .png({
      adaptiveFiltering: true,
      compressionLevel: 9,
      force: true,
    })
    .toBuffer();

  return pngBuffer;
}
