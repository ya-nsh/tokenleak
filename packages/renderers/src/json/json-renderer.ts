import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import { redactPromptsForExport } from '@tokenleak/core';
import type { IRenderer } from '../renderer';

export class JsonRenderer implements IRenderer {
  readonly format = 'json' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    // JSON is the export format; prompt text stays local unless asked for.
    const exported = options.includePrompts ? output : redactPromptsForExport(output);
    return JSON.stringify(exported, null, 2);
  }
}
