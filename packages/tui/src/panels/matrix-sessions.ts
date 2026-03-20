import { Box, Text } from '@opentui/core';
import type { SessionMetrics, ProjectDrilldownEntry } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatTokens, formatCost, padRight, padLeft, truncate } from '../lib/format.js';

/** Stat row helper */
function statRow(label: string, value: string, valueColor: string = COLORS.green) {
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: label, fg: COLORS.dimWhite }),
    Text({ content: '  ' }),
    Text({ content: value, fg: valueColor, attributes: BOLD }),
  );
}

/** Format milliseconds to human-readable duration */
function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return 'N/A';
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

/** Sessions stats panel */
export function createSessionsPanel(sessions: SessionMetrics) {
  const longestDuration = sessions.longestSession
    ? formatDuration(sessions.longestSession.durationMs)
    : 'N/A';

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.cyan,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' SESSIONS ', fg: COLORS.cyan, attributes: BOLD }),
    statRow('Total', `${sessions.totalSessions} sessions`),
    statRow('Avg Tokens', `${formatTokens(sessions.averageTokens)}/sess`),
    statRow('Avg Cost', `${formatCost(sessions.averageCost)}/sess`),
    statRow('Longest', longestDuration),
    statRow('Projects', `${sessions.projectCount}`),
  );
}

/** Top projects panel */
export function createTopProjectsPanel(projects: ProjectDrilldownEntry[]) {
  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (projects.length === 0) {
    children.push(Text({ content: 'No project data available', fg: COLORS.dimWhite }));
  } else {
    const top8 = projects.slice(0, 8);
    for (let i = 0; i < top8.length; i++) {
      const p = top8[i]!;
      const rank = `${i + 1}.`;
      const name = truncate(p.directory ?? p.projectId, 20);
      const isTop = i === 0;

      children.push(
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({ content: padRight(rank, 3), fg: COLORS.dimWhite }),
          Text({
            content: padRight(name, 21),
            fg: isTop ? COLORS.amber : COLORS.green,
            attributes: isTop ? BOLD : undefined,
          }),
          Text({ content: padLeft(formatTokens(p.totalTokens), 8), fg: COLORS.green }),
          Text({ content: padLeft(formatCost(p.cost), 10), fg: COLORS.amber }),
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
    Text({ content: ' TOP PROJECTS ', fg: COLORS.magenta, attributes: BOLD }),
    ...children,
  );
}
