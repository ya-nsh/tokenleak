import type { TokenleakOutput } from '@tokenleak/core';
import { renderWrappedSlidesSvg } from '../svg/wrapped-slides';
import sharp from 'sharp';

// Lower density than terminal-card because wrapped is much taller (3000-4000px SVG).
// 216 DPI gives 2x resolution (2400px wide) — sharp and fast to render.
const PNG_DENSITY = 216;

/**
 * Render a full "AI Coding Wrapped" multi-slide tall PNG image.
 * The image is 1200px wide with dynamic height based on content.
 */
export async function renderWrappedPng(
  output: TokenleakOutput,
  options: { theme: 'dark' | 'light' },
): Promise<Buffer> {
  const svgString = renderWrappedSlidesSvg(output, options);

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
