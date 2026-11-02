import { formatTokenCount, formatUsd } from '@tokenleak/core';
import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderCompactDashboard } from './compact';
import { renderDashboardModel } from './dashboard';
import { buildDashboardModel } from './dashboard-model';
import { renderOneliner } from './oneliner';
import { renderCompareView } from './tab-views';
import { renderModelEfficiencySection } from './tab-views/model-view';

const MIN_COMPACT_WIDTH = 32;

/** Compare is what `--compare` asked for, so it leads instead of trailing the dashboard. */
function appendCompareSection(rendered: string, output: TokenleakOutput, options: RenderOptions): string {
  if (!output.more?.compare) {
    return rendered;
  }

  return `${renderCompareView(output, options.width, options.noColor)}\n\n${rendered}`;
}

function appendCostCompletenessWarning(rendered: string, output: TokenleakOutput): string {
  const completeness = output.aggregated.costCompleteness;
  if (!completeness || completeness.status === 'complete') {
    return rendered;
  }

  const models = completeness.unknownModels.slice(0, 4).join(', ');
  const suffix = completeness.unknownModels.length > 4 ? ', ...' : '';
  const modelText = models ? ` Unknown pricing: ${models}${suffix}.` : '';
  return `${rendered}\n\nCost totals are incomplete: ${formatTokenCount(completeness.unpricedTokens)} tokens were not priced.${modelText}`;
}

function appendCacheRoiSection(rendered: string, output: TokenleakOutput, options: RenderOptions): string {
  if (!options.more || !output.more?.cacheRoi) {
    return rendered;
  }

  const roi = output.more.cacheRoi;
  const bestProject = roi.byProject[0];
  const lines = [
    'Cache ROI',
    `  Net savings ${formatUsd(roi.summary.netSavings)}  Read savings ${formatUsd(roi.summary.readSavings)}  Write cost ${formatUsd(roi.summary.writeCost)}`,
    `  Reuse ${roi.summary.reuseRatio === null ? 'n/a' : `${roi.summary.reuseRatio.toFixed(2)}x`}  Payback ${roi.summary.paybackRatio === null ? 'n/a' : `${roi.summary.paybackRatio.toFixed(2)}x`}  Cache reads ${formatTokenCount(roi.summary.readTokens)}`,
  ];

  if (bestProject) {
    lines.push(`  Top project ${bestProject.label} (${formatUsd(bestProject.netSavings)} net)`);
  }

  return `${rendered}\n\n${lines.join('\n')}`;
}

function appendModelEfficiencySection(
  rendered: string,
  output: TokenleakOutput,
  options: RenderOptions,
): string {
  if (!options.more || options.width < MIN_COMPACT_WIDTH || !output.more?.modelEfficiency) {
    return rendered;
  }

  const section = renderModelEfficiencySection(output, options.width, options.noColor, {
    title: 'Model Efficiency',
    limit: 3,
    includeMethod: true,
    includeIneligible: true,
  });

  if (!section) {
    return rendered;
  }

  return `${rendered}\n\n${section}`;
}

export class TerminalRenderer implements IRenderer {
  readonly format = 'terminal' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    const effectiveOptions: RenderOptions = {
      ...options,
      noColor: options.noColor,
    };

    if (effectiveOptions.width < MIN_COMPACT_WIDTH) {
      return appendCostCompletenessWarning(
        appendCompareSection(renderOneliner(output, effectiveOptions), output, effectiveOptions),
        output,
      );
    }

    const model = buildDashboardModel(output, effectiveOptions);

    if (model.mode === 'compact') {
      return appendCostCompletenessWarning(
        appendModelEfficiencySection(
          appendCacheRoiSection(
            appendCompareSection(renderCompactDashboard(model, effectiveOptions), output, effectiveOptions),
            output,
            effectiveOptions,
          ),
          output,
          effectiveOptions,
        ),
        output,
      );
    }

    return appendCostCompletenessWarning(
      appendModelEfficiencySection(
        appendCacheRoiSection(
          appendCompareSection(renderDashboardModel(model, effectiveOptions), output, effectiveOptions),
          output,
          effectiveOptions,
        ),
        output,
        effectiveOptions,
      ),
      output,
    );
  }
}
