import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderTerminalCardSvg } from '../png/terminal-card';

export class SvgRenderer implements IRenderer {
  readonly format = 'svg' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    return renderTerminalCardSvg(output, {
      ...options,
      format: 'svg',
    });
  }
}
