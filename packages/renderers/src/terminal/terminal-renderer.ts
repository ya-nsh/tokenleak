import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderCompactDashboard } from './compact';
import { renderDashboardModel } from './dashboard';
import { buildDashboardModel } from './dashboard-model';
import { renderOneliner } from './oneliner';

const MIN_COMPACT_WIDTH = 32;

export class TerminalRenderer implements IRenderer {
  readonly format = 'terminal' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    const effectiveOptions: RenderOptions = {
      ...options,
      noColor: options.noColor,
    };
    const model = buildDashboardModel(output, effectiveOptions);

    if (effectiveOptions.width < MIN_COMPACT_WIDTH) {
      return renderOneliner(output, effectiveOptions);
    }

    if (model.mode === 'compact') {
      return renderCompactDashboard(model, effectiveOptions);
    }

    return renderDashboardModel(model, effectiveOptions);
  }
}
