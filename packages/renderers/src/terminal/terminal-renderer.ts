import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderCompactDashboard } from './compact';
import { renderDashboardModel } from './dashboard';
import { buildDashboardModel } from './dashboard-model';
import { renderOneliner } from './oneliner';
import { renderCompareView } from './tab-views';

const MIN_COMPACT_WIDTH = 32;

export class TerminalRenderer implements IRenderer {
  readonly format = 'terminal' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    const effectiveOptions: RenderOptions = {
      ...options,
      noColor: options.noColor,
    };

    if (effectiveOptions.width < MIN_COMPACT_WIDTH) {
      return renderOneliner(output, effectiveOptions);
    }

    const model = buildDashboardModel(output, effectiveOptions);

    if (model.mode === 'compact') {
      return renderCompactDashboard(model, effectiveOptions);
    }

    const rendered = renderDashboardModel(model, effectiveOptions);
    if (!output.more?.compare) {
      return rendered;
    }

    return `${rendered}\n\n${renderCompareView(output, effectiveOptions.width, effectiveOptions.noColor)}`;
  }
}
