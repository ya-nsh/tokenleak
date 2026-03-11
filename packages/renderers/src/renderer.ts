import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';

export interface IRenderer {
  readonly format: string;
  render(output: TokenleakOutput, options: RenderOptions): Promise<string | Buffer>;
}
