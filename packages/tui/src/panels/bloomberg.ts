import { Box } from '@opentui/core';
import type { AppState } from '../lib/state.js';
import { createOverviewPanel } from './overview.js';
import { createTimeWindowsPanel } from './time-windows.js';
import { createProvidersPanel } from './providers.js';
import { createTopModelsPanel } from './top-models.js';

export function createBloombergView(state: AppState) {
  const data = state.data;
  const stats = data?.windows[state.selectedWindowIndex]?.stats ?? data?.allTimeStats ?? null;
  const providers = data?.providers ?? [];
  const windows = data?.windows ?? [];
  const topModels = stats?.topModels ?? [];

  return Box(
    { flexDirection: 'column', width: '100%', height: '100%', flexGrow: 1 },

    // Top row: Overview + Time Windows
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createOverviewPanel({ stats, providers }),
      createTimeWindowsPanel({ windows }),
    ),

    // Bottom row: Providers + Top Models
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%', height: '50%' },
      createProvidersPanel({ providers, allTimeStats: stats }),
      createTopModelsPanel({ models: topModels }),
    ),
  );
}
