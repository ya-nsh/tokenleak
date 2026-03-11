import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { SvgRenderer } from '../svg/index';
import sharp from 'sharp';

export class PngRenderer implements IRenderer {
  readonly format = 'png' as const;

  private readonly svgRenderer = new SvgRenderer();

  async render(output: TokenleakOutput, options: RenderOptions): Promise<Buffer> {
    const svgString = await this.svgRenderer.render(output, options);
    const pngBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
    return pngBuffer;
  }
}
