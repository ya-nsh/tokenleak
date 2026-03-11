import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';

export class JsonRenderer implements IRenderer {
  readonly format = 'json' as const;

  async render(output: TokenleakOutput, _options: RenderOptions): Promise<string> {
    return JSON.stringify(output, null, 2);
  }
}
