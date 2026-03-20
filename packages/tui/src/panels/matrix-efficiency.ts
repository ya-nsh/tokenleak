import { Box, Text } from '@opentui/core';
import type { ModelEfficiencyMetrics, AttributionCluster, SessionDrilldownEntry, CacheRoiMetrics } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { padRight, padLeft, truncate, formatTokens, formatCost } from '../lib/format.js';

/** Model efficiency panel — ranked by composite score */
export function createModelEfficiencyPanel(efficiency: ModelEfficiencyMetrics | null | undefined) {
  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (!efficiency || efficiency.rankings.length === 0) {
    children.push(Text({ content: 'Insufficient data for efficiency ranking', fg: COLORS.dimWhite }));
  } else {
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('#', 3), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padRight('Model', 22), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Score', 7), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('$/M', 8), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('O/I', 6), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Cache', 7), fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(53), fg: COLORS.dimWhite }),
    );

    const top8 = efficiency.rankings.slice(0, 8);
    for (let i = 0; i < top8.length; i++) {
      const r = top8[i]!;
      const isTop = i === 0;
      const costPerM = `$${r.costPer1MTotal.toFixed(1)}`;
      const oi = r.outputInputRatio.toFixed(2);
      const cache = `${(r.cacheCoverage * 100).toFixed(0)}%`;

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: padRight(`${i + 1}.`, 3), fg: COLORS.dimWhite }),
          Text({
            content: padRight(truncate(r.model, 21), 22),
            fg: isTop ? COLORS.amber : COLORS.green,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: padLeft(r.score.toFixed(2), 7), fg: COLORS.cyan, attributes: BOLD }),
          Text({ content: padLeft(costPerM, 8), fg: COLORS.amber }),
          Text({ content: padLeft(oi, 6), fg: COLORS.green }),
          Text({ content: padLeft(cache, 7), fg: COLORS.magenta }),
        ),
      );
    }
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.cyan,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' MODEL EFFICIENCY ', fg: COLORS.cyan, attributes: BOLD }),
    ...children,
  );
}

/** Attribution clusters panel */
export function createAttributionPanel(attribution: AttributionCluster[] | null | undefined) {
  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (!attribution || attribution.length === 0) {
    children.push(Text({ content: 'No attribution data available', fg: COLORS.dimWhite }));
  } else {
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('Cluster', 16), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padRight('Style', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Tokens', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Sessions', 10), fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(46), fg: COLORS.dimWhite }),
    );

    const top8 = attribution.slice(0, 8);
    for (let i = 0; i < top8.length; i++) {
      const c = top8[i]!;
      const isTop = i === 0;

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({
            content: padRight(truncate(c.label, 15), 16),
            fg: isTop ? COLORS.amber : COLORS.green,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: padRight(c.taskStyle, 10), fg: COLORS.cyan }),
          Text({ content: padLeft(formatTokens(c.tokens), 10), fg: COLORS.green }),
          Text({ content: padLeft(String(c.sessionCount), 10), fg: COLORS.white }),
        ),
      );
    }
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.magenta,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' ATTRIBUTION ', fg: COLORS.magenta, attributes: BOLD }),
    ...children,
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '-';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Top sessions panel — ranked by totalTokens */
export function createTopSessionsPanel(sessions: SessionDrilldownEntry[] | null | undefined) {
  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (!sessions || sessions.length === 0) {
    children.push(Text({ content: 'No session data available', fg: COLORS.dimWhite }));
  } else {
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('#', 3), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padRight('Session', 20), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Tokens', 9), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Cost', 9), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Dur', 9), fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(50), fg: COLORS.dimWhite }),
    );

    const sorted = [...sessions].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 6);
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]!;
      const name = s.directory ?? s.label;
      const isTop = i === 0;

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: padRight(`${i + 1}.`, 3), fg: COLORS.dimWhite }),
          Text({
            content: padRight(truncate(name, 18), 20),
            fg: isTop ? COLORS.amber : COLORS.green,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: padLeft(formatTokens(s.totalTokens), 9), fg: COLORS.green }),
          Text({ content: padLeft(formatCost(s.cost), 9), fg: COLORS.amber }),
          Text({ content: padLeft(formatDuration(s.durationMs), 9), fg: COLORS.cyan }),
        ),
      );
    }
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.green,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' TOP SESSIONS ', fg: COLORS.green, attributes: BOLD }),
    ...children,
  );
}

/** Cache ROI by model panel */
export function createCacheRoiByModelPanel(cacheRoi: CacheRoiMetrics | null | undefined) {
  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (!cacheRoi || cacheRoi.byModel.length === 0) {
    children.push(Text({ content: 'No cache ROI data', fg: COLORS.dimWhite }));
  } else {
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: padRight('Model', 20), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Net$', 10), fg: COLORS.amber, attributes: BOLD }),
        Text({ content: padLeft('Payback', 10), fg: COLORS.amber, attributes: BOLD }),
      ),
    );
    children.push(
      Text({ content: '\u2500'.repeat(40), fg: COLORS.dimWhite }),
    );

    const sorted = [...cacheRoi.byModel].sort((a, b) => b.netSavings - a.netSavings).slice(0, 6);
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i]!;
      const isTop = i === 0;
      const payback = m.paybackRatio !== null ? `${m.paybackRatio.toFixed(1)}x` : '-';

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({
            content: padRight(truncate(m.label, 18), 20),
            fg: isTop ? COLORS.amber : COLORS.green,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: padLeft(formatCost(m.netSavings), 10), fg: COLORS.green }),
          Text({ content: padLeft(payback, 10), fg: COLORS.cyan }),
        ),
      );
    }
  }

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.cyan,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' CACHE ROI BY MODEL ', fg: COLORS.cyan, attributes: BOLD }),
    ...children,
  );
}
