import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderTerminalCardSvg } from './terminal-card';
import sharp from 'sharp';

/** Render at 2x density (144 DPI) for crisp output */
const PNG_DENSITY = 144;

export class PngRenderer implements IRenderer {
  readonly format = 'png' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<Buffer> {
    const svgString = renderTerminalCardSvg(output, options);
    const pngBuffer = await sharp(Buffer.from(svgString), { density: PNG_DENSITY })
      .png()
      .toBuffer();
    return pngBuffer;
  }
}
