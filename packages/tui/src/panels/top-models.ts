import { Box, Text } from '@opentui/core';
import type { TopModelEntry } from '@tokenleak/core';
import { formatTokens, formatCost, padRight, padLeft, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

interface TopModelsProps {
  models: TopModelEntry[];
}

export function createTopModelsPanel(props: TopModelsProps) {
  const { models } = props;

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (models.length === 0) {
    children.push(Text({ content: 'No model data', fg: COLORS.dimWhite }));
  } else {
    // Header
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('#', 3), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padRight('Model', 28), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Tokens', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Cost', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Share', 8), fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(59), fg: COLORS.dimWhite }),
    );

    const top10 = models.slice(0, 10);

    for (let i = 0; i < top10.length; i++) {
      const m = top10[i]!;
      const isTop = i === 0;
      const nameColor = isTop ? COLORS.amber : COLORS.green;
      const rank = `${i + 1}.`;

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: padRight(rank, 3), fg: COLORS.dimWhite }),
          Text({
            content: padRight(truncate(m.model, 27), 28),
            fg: nameColor,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: padLeft(formatTokens(m.tokens), 10), fg: COLORS.green }),
          Text({ content: padLeft(formatCost(m.cost), 10), fg: COLORS.amber }),
          Text({
            content: padLeft(`${m.percentage.toFixed(1)}%`, 8),
            fg: COLORS.white,
          }),
        ),
      );
    }
  }

  return Box(
    {
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: COLORS.magenta,
      padding: 1,
      flexGrow: 1,
      title: ' TOP MODELS ',
    },
    ...children,
  );
}
