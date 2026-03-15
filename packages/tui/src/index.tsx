import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import type { TokenleakOutput, DateRange } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import { App } from './app.js';
import type {
  InteractiveContext,
  InteractiveExecutionResult,
  InteractiveRunRequest,
} from './menu/types.js';

export type {
  InteractiveRunRequest,
  InteractiveExecutionResult,
  InteractiveCommand,
  InteractiveContext,
  TabbedDashboardOptions,
  MenuOption,
  CliArgs,
} from './menu/types.js';

export {
  shouldStartInteractiveCli,
  clampScrollOffset,
  stripAnsi,
  visibleLength,
  buildTabbedDashboardOptions,
  finalizeCliArgs,
  buildCliPreview,
  buildCliArgTokens,
  describeRequest,
  computeDateRange,
} from './menu/utils.js';

export {
  INTERACTIVE_FLAG_LINES,
  getMenuOptionsMeta,
  PROVIDER_CHOICES,
} from './menu/options.js';

/** @deprecated Use getMenuOptionsMeta() instead. */
export { getMenuOptionsMeta as createMenuOptions } from './menu/options.js';

export { renderProgressBar } from './views/loading-compat.js';

export type StartTuiOptions = {
  context: InteractiveContext;
  providers: IProvider[];
  execute: (request: InteractiveRunRequest) => Promise<InteractiveExecutionResult>;
  loadData: (providers: IProvider[], range: DateRange, compare: string | null) => Promise<TokenleakOutput>;
};

/**
 * Launch the OpenTUI-powered interactive CLI.
 * Goes directly into the tabbed dashboard view.
 */
export async function startTui(options: StartTuiOptions): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  return new Promise<void>((resolve) => {
    const root = createRoot(renderer);
    root.render(
      <App
        context={options.context}
        providers={options.providers}
        execute={options.execute}
        loadData={options.loadData}
        onExit={() => {
          root.unmount();
          resolve();
        }}
      />,
    );
  });
}
