import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { renderCompactDashboard } from './compact';
import { renderDashboardModel } from './dashboard';
import { buildDashboardModel } from './dashboard-model';
import { renderOneliner } from './oneliner';
import { renderCompareView } from './tab-views';
import { renderModelEfficiencySection } from './tab-views/model-view';

const MIN_COMPACT_WIDTH = 32;

function appendCompareSection(rendered: string, output: TokenleakOutput, options: RenderOptions): string {
  if (!output.more?.compare) {
    return rendered;
  }

  return `${rendered}\n\n${renderCompareView(output, options.width, options.noColor)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function appendCacheRoiSection(rendered: string, output: TokenleakOutput, options: RenderOptions): string {
  if (!options.more || !output.more?.cacheRoi) {
    return rendered;
  }

  const roi = output.more.cacheRoi;
  const bestProject = roi.byProject[0];
  const lines = [
    'Cache ROI',
    `  Net savings ${formatMoney(roi.summary.netSavings)}  Read savings ${formatMoney(roi.summary.readSavings)}  Write cost ${formatMoney(roi.summary.writeCost)}`,
    `  Reuse ${roi.summary.reuseRatio === null ? 'n/a' : `${roi.summary.reuseRatio.toFixed(2)}x`}  Payback ${roi.summary.paybackRatio === null ? 'n/a' : `${roi.summary.paybackRatio.toFixed(2)}x`}  Cache reads ${formatTokens(roi.summary.readTokens)}`,
  ];

  if (bestProject) {
    lines.push(`  Top project ${bestProject.label} (${formatMoney(bestProject.netSavings)} net)`);
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
      return appendCompareSection(renderOneliner(output, effectiveOptions), output, effectiveOptions);
    }

    const model = buildDashboardModel(output, effectiveOptions);

    if (model.mode === 'compact') {
      return appendModelEfficiencySection(
        appendCacheRoiSection(
          appendCompareSection(renderCompactDashboard(model, effectiveOptions), output, effectiveOptions),
          output,
          effectiveOptions,
        ),
        output,
        effectiveOptions,
      );
    }

    return appendModelEfficiencySection(
      appendCacheRoiSection(
        appendCompareSection(renderDashboardModel(model, effectiveOptions), output, effectiveOptions),
        output,
        effectiveOptions,
      ),
      output,
      effectiveOptions,
    );
  }
}
