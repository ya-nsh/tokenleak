import { useState, useCallback, useMemo, useRef } from 'react';
import type { TokenleakOutput, DateRange } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import type {
  InteractiveContext,
  InteractiveExecutionResult,
  InteractiveRunRequest,
  TabbedDashboardOptions,
} from './menu/types.js';
import { Dashboard } from './views/dashboard.js';

export type AppProps = {
  context: InteractiveContext;
  providers: IProvider[];
  execute: (request: InteractiveRunRequest) => Promise<InteractiveExecutionResult>;
  loadData: (providers: IProvider[], range: DateRange, compare: string | null) => Promise<TokenleakOutput>;
  onExit: () => void;
};

/**
 * Root app — launches directly into the tabbed dashboard.
 * The dashboard handles all navigation (time ranges, metric tabs, scroll).
 * Press q/Esc to exit.
 */
export function App({ providers, loadData, onExit }: AppProps) {
  const defaultOptions = useMemo((): TabbedDashboardOptions => ({
    noColor: false,
    compare: 'auto',
    initialTimeRange: '30d',
  }), []);

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Dashboard
        providers={providers}
        options={defaultOptions}
        loadData={loadData}
        onExit={onExit}
      />
    </box>
  );
}
