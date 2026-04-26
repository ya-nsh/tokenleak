import type { Receipt } from '@tokenleak/core';
import sharp from 'sharp';
import { renderReceiptSvg } from '../svg/receipt';

const PNG_DENSITY = 216;

/**
 * Render a tokenleak receipt as a PNG buffer (800px wide at 1x).
 */
export async function renderReceiptPng(
  receipt: Receipt,
  options: { theme?: 'dark' | 'light' } = {},
): Promise<Buffer> {
  const svgString = renderReceiptSvg(receipt, options);

  return sharp(Buffer.from(svgString), { density: PNG_DENSITY })
    .png({ adaptiveFiltering: true, compressionLevel: 9, force: true })
    .toBuffer();
}
