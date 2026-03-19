import { Box, Text } from '@opentui/core';
import type { AggregatedStats, TopModelEntry } from '@tokenleak/core';
import { formatTokens, formatCost, truncate, padRight, padLeft } from '../lib/format.js';
import { COLORS, BOLD, MODEL_COLORS } from '../lib/theme.js';
import type { AppState, SortMode } from '../lib/state.js';

interface ModelDetail {
  model: string;
  tokens: number;
  cost: number;
  percentage: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function createModelList(state: AppState, stats: AggregatedStats | null) {
  if (state.isLoading || !stats) {
    const skeletonRows: ReturnType<typeof Text>[] = [];
    for (let i = 0; i < 5; i++) {
      skeletonRows.push(
        Text({ content: '\u2500'.repeat(50), fg: COLORS.dimWhite }),
      );
    }
    return Box(
      {
        flexDirection: 'column',
        border: true,
        borderStyle: 'single',
        borderColor: COLORS.dimWhite,
        padding: 1,
        width: '100%',
        flexGrow: 1,
        title: ' Models by Cost ',
      },
      ...skeletonRows,
    );
  }

  const models = stats.topModels;
  const sortedModels = [...models].sort((a, b) =>
    state.sortMode === 'cost' ? b.cost - a.cost : b.tokens - a.tokens,
  );

  const totalCost = stats.totalCost;

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  // Header
  children.push(
    Box(
      { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
      Text({
        content: `Models by ${state.sortMode === 'cost' ? 'Cost' : 'Tokens'}`,
        fg: COLORS.amber,
        attributes: BOLD,
      }),
      Text({
        content: `Total: ${formatCost(totalCost)}`,
        fg: COLORS.amber,
        attributes: BOLD,
      }),
    ),
  );

  children.push(
    Text({ content: '\u2500'.repeat(60), fg: COLORS.dimWhite }),
  );

  // Visible models based on scroll offset
  const visibleCount = 10;
  const offset = Math.min(state.modelScrollOffset, Math.max(0, sortedModels.length - visibleCount));
  const visible = sortedModels.slice(offset, offset + visibleCount);

  if (offset > 0) {
    children.push(
      Text({ content: `  \u25b2 ${offset} more above`, fg: COLORS.dimWhite }),
    );
  }

  for (let i = 0; i < visible.length; i++) {
    const m = visible[i]!;
    const colorIdx = sortedModels.indexOf(m);
    const color = MODEL_COLORS[colorIdx % MODEL_COLORS.length]!;
    const pct = `(${m.percentage.toFixed(1)}%)`;
    const nameStr = truncate(m.model, 30);
    const costStr = formatCost(m.cost);
    const tokStr = formatTokens(m.tokens);

    // Single line: ● name (pct%)    cost    tokens
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: '\u25cf ', fg: color }),
        Text({
          content: padRight(nameStr, 31),
          fg: colorIdx === 0 ? COLORS.amber : COLORS.white,
          attributes: colorIdx === 0 ? BOLD : undefined,
        }),
        Text({ content: padRight(pct, 9), fg: COLORS.dimWhite }),
        Text({ content: padLeft(costStr, 10), fg: COLORS.amber }),
        Text({ content: padLeft(tokStr, 10), fg: COLORS.green }),
      ),
    );
  }

  if (offset + visibleCount < sortedModels.length) {
    children.push(
      Text({
        content: `  \u25bc ${sortedModels.length - offset - visibleCount} more below`,
        fg: COLORS.dimWhite,
      }),
    );
  }

  return Box(
    {
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: COLORS.magenta,
      padding: 1,
      width: '100%',
      flexGrow: 2,
      title: ' Models by Cost ',
    },
    ...children,
  );
}
