import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderDashboard } from './dashboard';
import { renderOneliner } from './oneliner';

const MIN_DASHBOARD_WIDTH = 40;

export class TerminalRenderer implements IRenderer {
  readonly format = 'terminal' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    const effectiveOptions: RenderOptions = {
      ...options,
      noColor: options.noColor,
    };

    if (effectiveOptions.width < MIN_DASHBOARD_WIDTH) {
      return renderOneliner(output, effectiveOptions);
    }

    return renderDashboard(output, effectiveOptions);
  }
}
