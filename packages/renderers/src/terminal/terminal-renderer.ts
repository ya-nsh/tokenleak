import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderCompactDashboard } from './compact';
import { renderDashboardModel } from './dashboard';
import { buildDashboardModel } from './dashboard-model';
import { renderOneliner } from './oneliner';
import { renderCompareView } from './tab-views';

const MIN_COMPACT_WIDTH = 32;

function appendCompareSection(rendered: string, output: TokenleakOutput, options: RenderOptions): string {
  if (!output.more?.compare) {
    return rendered;
  }

  return `${rendered}\n\n${renderCompareView(output, options.width, options.noColor)}`;
}

export class TerminalRenderer implements IRenderer {
  readonly format = 'terminal' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    const effectiveOptions: RenderOptions = {
      ...options,
      noColor: options.noColor,
    };

    if (effectiveOptions.width < MIN_COMPACT_WIDTH) {
      return appendCompareSection(renderOneliner(output, effectiveOptions), output, effectiveOptions);
    }

    const model = buildDashboardModel(output, effectiveOptions);

    if (model.mode === 'compact') {
      return appendCompareSection(renderCompactDashboard(model, effectiveOptions), output, effectiveOptions);
    }

    return appendCompareSection(renderDashboardModel(model, effectiveOptions), output, effectiveOptions);
  }
}
