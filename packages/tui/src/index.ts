import { Box, Text, createCliRenderer, createTextAttributes } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { COLORS, BOLD } from './lib/theme.js';
import { formatCost } from './lib/format.js';
import { loadAllData, type TuiData } from './lib/data.js';
import { createOverviewPanel } from './panels/overview.js';
import { createTimeWindowsPanel } from './panels/time-windows.js';
import { createProvidersPanel } from './panels/providers.js';
import { createTopModelsPanel } from './panels/top-models.js';

function formatDateTime(): string {
  return new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function buildTopBar(totalCost: number | null) {
  const costStr = totalCost !== null ? formatCost(totalCost) : '$...';

  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      justifyContent: 'space-between',
      paddingLeft: 1,
      paddingRight: 1,
      height: 1,
    },
    Box(
      { flexDirection: 'row', gap: 2 },
      Text({ content: ' TOKENLEAK ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: 'Bloomberg Terminal', fg: COLORS.dimWhite }),
    ),
    Box(
      { flexDirection: 'row', gap: 2 },
      Text({ content: `TOTAL: ${costStr}`, fg: COLORS.amber, attributes: BOLD }),
      Text({ content: formatDateTime(), fg: COLORS.green }),
    ),
  );
}

function buildBottomBar(lastRefresh: string) {
  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      justifyContent: 'space-between',
      paddingLeft: 1,
      paddingRight: 1,
      height: 1,
    },
    Text({
      content: 'q: quit | r: refresh | 1-4: focus panel',
      fg: COLORS.dimWhite,
    }),
    Text({
      content: `Last refresh: ${lastRefresh}`,
      fg: COLORS.dimWhite,
    }),
  );
}

function buildLayout(data: TuiData | null) {
  const stats = data?.allTimeStats ?? null;
  const providers = data?.providers ?? [];
  const windows = data?.windows ?? [];
  const topModels = stats?.topModels ?? [];
  const totalCost = stats?.totalCost ?? null;

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: COLORS.bg,
    },
    // Top bar
    buildTopBar(totalCost),

    // Main grid - top row
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%' },
      createOverviewPanel({ stats, providers }),
      createTimeWindowsPanel({ windows }),
    ),

    // Main grid - bottom row
    Box(
      { flexDirection: 'row', flexGrow: 1, width: '100%' },
      createProvidersPanel({ providers, allTimeStats: stats }),
      createTopModelsPanel({ models: topModels }),
    ),

    // Bottom bar
    buildBottomBar(formatDateTime()),
  );
}

function clearRoot(renderer: CliRenderer): void {
  const children = renderer.root.getChildren();
  for (const child of children) {
    renderer.root.remove(child.id);
  }
}

async function main(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: COLORS.bg,
  });

  // Show skeleton immediately
  renderer.root.add(buildLayout(null));
  renderer.requestRender();

  // Load data in background
  try {
    const data = await loadAllData();

    // Clear and rebuild with real data
    clearRoot(renderer);
    renderer.root.add(buildLayout(data));
    renderer.requestRender();

    // Set up refresh handler
    renderer.addInputHandler((sequence: string) => {
      if (sequence === 'r') {
        clearRoot(renderer);
        renderer.root.add(buildLayout(null));
        renderer.requestRender();

        loadAllData().then((freshData) => {
          clearRoot(renderer);
          renderer.root.add(buildLayout(freshData));
          renderer.requestRender();
        }).catch(() => {
          // Keep showing loading state on error
        });
        return true;
      }
      if (sequence === 'q') {
        renderer.destroy();
        process.exit(0);
      }
      return false;
    });
  } catch (err: unknown) {
    clearRoot(renderer);
    renderer.root.add(
      Box(
        {
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: COLORS.bg,
          justifyContent: 'center',
          alignItems: 'center',
        },
        Text({
          content: 'TOKENLEAK TUI',
          fg: COLORS.amber,
          attributes: BOLD,
        }),
        Text({
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          fg: COLORS.red,
        }),
        Text({
          content: 'Press q to quit',
          fg: COLORS.dimWhite,
        }),
      ),
    );
    renderer.requestRender();

    renderer.addInputHandler((sequence: string) => {
      if (sequence === 'q') {
        renderer.destroy();
        process.exit(0);
      }
      return false;
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
