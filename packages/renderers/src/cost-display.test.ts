import { describe, expect, it } from 'bun:test';
import { aggregate } from '@tokenleak/core';
import type { TokenleakOutput } from '@tokenleak/core';
import { createOutput, createProvider, createRenderOptions } from './__test-fixtures__';
import { generateHtml } from './live/template';
import { renderTerminalCardSvg } from './png/terminal-card';
import { renderWrappedCard } from './svg/wrapped';
import { renderWrappedSlidesSvg } from './svg/wrapped-slides';
import { renderWrappedSinglePageSvg } from './svg/wrapped-single-page';
import { renderTokenView } from './terminal/tab-views/token-view';
import { renderProviderView } from './terminal/tab-views/provider-view';

function outputWithCost(source: 'unpriced' | 'provider-reported'): TokenleakOutput {
  const provider = createProvider('codex', 'Codex');
  provider.totalCost = 0;
  for (const day of provider.daily) {
    day.cost = 0;
    for (const model of day.models) {
      model.cost = 0;
      model.costSource = source;
    }
  }
  return createOutput({ providers: [provider], aggregated: aggregate(provider.daily, '2026-03-11') });
}

const renderers: [string, (output: TokenleakOutput) => string][] = [
  ['live dashboard', (output) => generateHtml(output, createRenderOptions())],
  ['terminal card', (output) => renderTerminalCardSvg(output, createRenderOptions())],
  ['wrapped card', (output) => renderWrappedCard(output)],
  ['wrapped slides', (output) => renderWrappedSlidesSvg(output, { theme: 'dark' })],
  ['wrapped single page', (output) => renderWrappedSinglePageSvg(output)],
  ['token tab', (output) => renderTokenView(output, 96, true)],
  ['provider tab', (output) => renderProviderView(output, 96, true)],
];

describe('cost labels across report formats', () => {
  for (const [name, render] of renderers) {
    it(`${name} distinguishes unpriced usage from reported zero cost`, () => {
      const unknown = render(outputWithCost('unpriced'));
      expect(unknown).toContain('Unknown');
      expect(unknown).not.toContain('$0.00');
      const free = render(outputWithCost('provider-reported'));
      expect(free).toContain('$0.00');
      expect(free).not.toContain('Unknown');
    });

    it(`${name} marks partial estimates with a plus sign`, () => {
      const output = outputWithCost('unpriced');
      const day = output.providers[0]!.daily[0]!;
      day.cost = 1;
      day.models[0]!.cost = 1;
      day.models[0]!.costSource = 'provider-reported';
      output.providers[0]!.totalCost = 1;
      output.aggregated = aggregate(output.providers[0]!.daily, '2026-03-11');
      expect(render(output)).toContain('$1.00+');
    });
  }
});
