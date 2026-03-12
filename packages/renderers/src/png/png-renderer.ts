import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderTerminalCardSvg } from './terminal-card';
import sharp from 'sharp';

export class PngRenderer implements IRenderer {
  readonly format = 'png' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<Buffer> {
    const svgString = renderTerminalCardSvg(output, options);
    const pngBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
    return pngBuffer;
  }
}
