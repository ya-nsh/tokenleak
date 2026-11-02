import { describe, expect, it } from 'bun:test';
import { aggregate } from '@tokenleak/core';
import type { TokenleakOutput } from '@tokenleak/core';
import { createOutput, createProvider, createRenderOptions } from './__test-fixtures__';
import { generateHtml } from './live/template';
import { renderTerminalCardSvg } from './png/terminal-card';
import { renderWrappedCard } from './svg/wrapped';
import { renderWrappedSlidesSvg } from './svg/wrapped-slides';
import { renderWrappedSinglePageSvg } from './svg/wrapped-single-page';
import { TerminalRenderer } from './terminal/terminal-renderer';

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

const terminal = new TerminalRenderer();

const renderers: [string, (output: TokenleakOutput) => string | Promise<string>][] = [
  ['live dashboard', (output) => generateHtml(output, createRenderOptions())],
  ['terminal card', (output) => renderTerminalCardSvg(output, createRenderOptions())],
  ['wrapped card', (output) => renderWrappedCard(output)],
  ['wrapped slides', (output) => renderWrappedSlidesSvg(output, { theme: 'dark' })],
  ['wrapped single page', (output) => renderWrappedSinglePageSvg(output)],
  ['terminal dashboard', (output) =>
    terminal.render(output, createRenderOptions({ format: 'terminal', width: 96, noColor: true }))],
];

describe('cost labels across report formats', () => {
  for (const [name, render] of renderers) {
    it(`${name} distinguishes unpriced usage from reported zero cost`, async () => {
      const unknown = await render(outputWithCost('unpriced'));
      expect(unknown).toContain('Unknown');
      expect(unknown).not.toContain('$0.00');
      const free = await render(outputWithCost('provider-reported'));
      expect(free).toContain('$0.00');
      expect(free).not.toContain('Unknown');
    });

    it(`${name} marks partial estimates with a plus sign`, async () => {
      const output = outputWithCost('unpriced');
      const day = output.providers[0]!.daily[0]!;
      day.cost = 1;
      day.models[0]!.cost = 1;
      day.models[0]!.costSource = 'provider-reported';
      output.providers[0]!.totalCost = 1;
      output.aggregated = aggregate(output.providers[0]!.daily, '2026-03-11');
      expect(await render(output)).toContain('$1.00+');
    });
  }
});
