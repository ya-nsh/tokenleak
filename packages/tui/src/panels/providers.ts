import { Box, Text } from '@opentui/core';
import type { ProviderData, AggregatedStats } from '@tokenleak/core';
import { formatTokens, formatCost, padRight, padLeft, asciiBar } from '../lib/format.js';
import { COLORS, BOLD, getProviderColor } from '../lib/theme.js';

interface ProvidersProps {
  providers: ProviderData[];
  allTimeStats: AggregatedStats | null;
}

export function createProvidersPanel(props: ProvidersProps) {
  const { providers, allTimeStats } = props;

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (providers.length === 0) {
    children.push(Text({ content: 'No providers found', fg: COLORS.dimWhite }));
  } else {
    // Header
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('Provider', 14), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Tokens', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Cost', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Share', 8), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: '  ' }),
        Text({ content: 'Bar', fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(58), fg: COLORS.dimWhite }),
    );

    // Sort by token count descending
    const sorted = [...providers].sort(
      (a, b) => b.totalTokens - a.totalTokens,
    );
    const totalTokens = allTimeStats?.totalTokens ?? sorted.reduce((s, p) => s + p.totalTokens, 0);

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!;
      const share = totalTokens > 0 ? p.totalTokens / totalTokens : 0;
      const color = getProviderColor(p.provider, i);

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: padRight(p.displayName, 14), fg: color, attributes: BOLD }),
          Text({ content: padLeft(formatTokens(p.totalTokens), 10), fg: COLORS.green }),
          Text({ content: padLeft(formatCost(p.totalCost), 10), fg: COLORS.amber }),
          Text({
            content: padLeft(`${(share * 100).toFixed(1)}%`, 8),
            fg: COLORS.white,
          }),
          Text({ content: ' ' }),
          Text({ content: asciiBar(share, 10), fg: color }),
        ),
      );
    }
  }

  return Box(
    {
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: COLORS.green,
      padding: 1,
      flexGrow: 1,
      title: ' PROVIDERS ',
    },
    ...children,
  );
}
