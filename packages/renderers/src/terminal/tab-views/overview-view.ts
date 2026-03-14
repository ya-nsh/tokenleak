import type { RenderOptions, TokenleakOutput } from '@tokenleak/core';
import { renderDashboardModel } from '../dashboard';
import { buildDashboardModel } from '../dashboard-model';

export function renderOverviewView(output: TokenleakOutput, options: RenderOptions): string {
  return renderDashboardModel(buildDashboardModel(output, options), options);
}
