import type { TimeRange } from '@tokenleak/renderers';
import type { DateRange } from '@tokenleak/core';

export type CliArgs = Record<string, unknown>;

export type InteractiveRunRequest = {
  args: CliArgs;
  argv?: string[];
  preview: string;
  title: string;
  loadingTitle: string;
  loadingDetail: string;
  executionMode: 'capture' | 'inherit';
};

export type InteractiveExecutionResult = {
  ok: boolean;
  summary: string;
  stdout: string;
  stderr: string;
};

export type InteractiveCommand =
  | { type: 'run'; request: InteractiveRunRequest }
  | { type: 'tabbed-dashboard'; options: TabbedDashboardOptions }
  | { type: 'show-help' }
  | { type: 'exit' };

export type MenuOption = {
  shortcut: string;
  title: string;
  description: string;
  preview: string;
  select: () => Promise<InteractiveCommand>;
};

export type InteractiveContext = {
  version: string;
  helpText: string;
};

export type InteractiveState = {
  selectedIndex: number;
};

export interface TabbedDashboardOptions {
  noColor: boolean;
  noInsights?: boolean;
  compare?: string;
  width?: number;
  until?: string;
  initialTimeRange?: TimeRange;
  initialRange?: DateRange;
  providerNames?: string[];
}
