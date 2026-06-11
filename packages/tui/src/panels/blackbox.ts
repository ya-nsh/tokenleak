import { Box, Text } from '@opentui/core';
import type { BlackBoxFocusMode, BlackBoxNode, BlackBoxTrace } from '@tokenleak/core';
import { formatCost, formatPercent, formatTokens, padRight, truncate, wrapText } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

export const BLACKBOX_MAX_CONTENT_WIDTH = 118;
const GRAPH_LINES = 13;
const INSPECTOR_LINES = 13;

export interface BlackBoxPanelState {
  blackBoxSelectedNodeIndex: number;
  blackBoxFocusMode: BlackBoxFocusMode;
  blackBoxExpanded: boolean;
  blackBoxTargetIndex: number;
}

interface GraphLine {
  nodeId: string | null;
  text: string;
  fg: string;
  bold?: boolean;
}

const FOCUS_LABELS: Record<BlackBoxFocusMode, string> = {
  all: 'all',
  'costly-path': 'costly path',
  waste: 'waste only',
  churn: 'cache/model churn',
};

const FOCUS_ORDER: BlackBoxFocusMode[] = ['all', 'costly-path', 'waste', 'churn'];

export function nextBlackBoxFocusMode(current: BlackBoxFocusMode): BlackBoxFocusMode {
  return FOCUS_ORDER[(FOCUS_ORDER.indexOf(current) + 1) % FOCUS_ORDER.length]!;
}

function nodeColor(node: BlackBoxNode): string {
  if (node.severity === 'high') return COLORS.red;
  if (node.kind === 'outcome') return COLORS.green;
  if (node.kind === 'cache') return COLORS.cyan;
  if (node.kind === 'model-switch') return COLORS.amber;
  if (node.kind === 'waste') return COLORS.red;
  if (node.severity === 'medium') return COLORS.amber;
  return COLORS.white;
}

function nodeGlyph(node: BlackBoxNode): string {
  switch (node.kind) {
    case 'session':
      return '◉';
    case 'flow-block':
      return '◆';
    case 'event':
      return '●';
    case 'model-switch':
      return '◇';
    case 'cache':
      return '△';
    case 'waste':
      return '✖';
    case 'outcome':
      return '✓';
  }
}

function timeLabel(timestamp: string | undefined): string {
  if (!timestamp) return '--:--';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function getBlackBoxFocusableNodeIds(
  trace: BlackBoxTrace | null,
  focusMode: BlackBoxFocusMode,
): string[] {
  if (!trace) return [];
  if (focusMode === 'costly-path') {
    return trace.hotPathNodeIds.filter((id) => trace.nodes.some((node) => node.id === id));
  }
  if (focusMode === 'waste') {
    return trace.wasteNodeIds.filter((id) => trace.nodes.some((node) => node.id === id));
  }
  if (focusMode === 'churn') {
    return trace.churnNodeIds.filter((id) => trace.nodes.some((node) => node.id === id));
  }
  return trace.nodes.map((node) => node.id);
}

function selectedNode(trace: BlackBoxTrace, state: BlackBoxPanelState): BlackBoxNode | null {
  const ids = getBlackBoxFocusableNodeIds(trace, state.blackBoxFocusMode);
  const id = ids[Math.max(0, Math.min(state.blackBoxSelectedNodeIndex, Math.max(0, ids.length - 1)))];
  return trace.nodes.find((node) => node.id === id) ?? trace.nodes[0] ?? null;
}

function graphLines(trace: BlackBoxTrace, state: BlackBoxPanelState, width: number): GraphLine[] {
  const ids = getBlackBoxFocusableNodeIds(trace, state.blackBoxFocusMode);
  const selectedIndex = Math.max(0, Math.min(state.blackBoxSelectedNodeIndex, Math.max(0, ids.length - 1)));
  const selectedId = ids[selectedIndex];
  const nodeWindowStart = Math.max(0, Math.min(selectedIndex - 4, Math.max(0, ids.length - GRAPH_LINES)));
  const visibleIds = ids.slice(nodeWindowStart, nodeWindowStart + GRAPH_LINES);
  const visibleNodes = visibleIds
    .map((id) => trace.nodes.find((node) => node.id === id))
    .filter((node): node is BlackBoxNode => Boolean(node));
  const lines: GraphLine[] = [];

  lines.push({ nodeId: null, text: '╔═ BLACK BOX TRACE BUS ═════════════════════════════╗', fg: COLORS.cyan, bold: true });
  lines.push({ nodeId: null, text: `║ focus ${FOCUS_LABELS[state.blackBoxFocusMode]} · target ${state.blackBoxTargetIndex + 1}/${Math.max(1, trace.targets.length)} ║`, fg: COLORS.dimWhite });
  lines.push({ nodeId: null, text: '╚════════════════════════════════════════════════════╝', fg: COLORS.cyan, bold: true });

  if (visibleNodes.length === 0) {
    lines.push({ nodeId: null, text: '   no nodes in this focus lane', fg: COLORS.dimWhite });
    return lines;
  }

  visibleNodes.forEach((node, index) => {
    const selected = node.id === selectedId;
    const branch = index === visibleNodes.length - 1 ? '└─' : '├─';
    const cost = node.cost > 0 ? formatCost(node.cost) : formatTokens(node.tokens);
    const line = `${selected ? '▸' : ' '} ${branch}${nodeGlyph(node)} ${timeLabel(node.timestamp)} ${truncate(node.label, Math.max(12, width - 28))} ${cost}`;
    lines.push({ nodeId: node.id, text: line, fg: selected ? COLORS.amber : nodeColor(node), bold: selected });
    if (selected) {
      lines.push({ nodeId: null, text: '  │  ━━━ cost current selected in neon bus ━━━', fg: COLORS.magenta, bold: true });
    } else if (index < visibleNodes.length - 1) {
      lines.push({ nodeId: null, text: '  │', fg: COLORS.dimWhite });
    }
  });

  const hiddenAbove = nodeWindowStart;
  const hiddenBelow = ids.length - nodeWindowStart - visibleNodes.length;
  if (hiddenAbove > 0 || hiddenBelow > 0) {
    lines.push({
      nodeId: null,
      text: `  └─ ${hiddenAbove} above · ${hiddenBelow} below`,
      fg: COLORS.dimWhite,
    });
  }
  return lines.slice(0, GRAPH_LINES + 4);
}

function inspectorLines(trace: BlackBoxTrace, state: BlackBoxPanelState, width: number): GraphLine[] {
  const node = selectedNode(trace, state);
  if (!node) {
    return [{ nodeId: null, text: 'No node selected', fg: COLORS.dimWhite }];
  }

  const lines: GraphLine[] = [
    { nodeId: node.id, text: `INSPECTOR // ${node.kind.toUpperCase()}`, fg: COLORS.magenta, bold: true },
    { nodeId: node.id, text: truncate(`${nodeGlyph(node)} ${node.label}`, width), fg: nodeColor(node), bold: true },
    { nodeId: node.id, text: `${formatTokens(node.tokens)} tok · ${formatCost(node.cost)} · ${node.severity}`, fg: COLORS.white },
  ];
  if (node.provider || node.model) {
    lines.push({ nodeId: node.id, text: truncate(`${node.provider ?? ''}${node.model ? ` · ${node.model}` : ''}`, width), fg: COLORS.dimWhite });
  }
  if (node.snippet) {
    lines.push({ nodeId: node.id, text: truncate(`prompt: ${node.snippet}`, width), fg: COLORS.cyan });
  }
  lines.push(...wrapText(node.reason, Math.max(16, width), state.blackBoxExpanded ? 3 : 2).map((line) => ({
    nodeId: node.id,
    text: line,
    fg: COLORS.white,
  })));

  const detailLimit = state.blackBoxExpanded ? node.details.length : Math.min(2, node.details.length);
  for (const detail of node.details.slice(0, detailLimit)) {
    lines.push({ nodeId: node.id, text: truncate(`- ${detail}`, width), fg: COLORS.dimWhite });
  }
  if (!state.blackBoxExpanded && node.details.length > detailLimit) {
    lines.push({ nodeId: node.id, text: '+ more details (enter)', fg: COLORS.dimWhite });
  }

  return lines.slice(0, INSPECTOR_LINES);
}

function combineColumns(left: GraphLine[], right: GraphLine[], leftWidth: number, rightWidth: number): GraphLine[] {
  const count = Math.max(left.length, right.length);
  const combined: GraphLine[] = [];
  for (let i = 0; i < count; i++) {
    const l = left[i];
    const r = right[i];
    combined.push({
      nodeId: l?.nodeId ?? r?.nodeId ?? null,
      text: `${padRight(truncate(l?.text ?? '', leftWidth), leftWidth)}  │ ${truncate(r?.text ?? '', rightWidth)}`,
      fg: l?.bold ? l.fg : (r?.fg ?? l?.fg ?? COLORS.dimWhite),
      bold: l?.bold || r?.bold,
    });
  }
  return combined;
}

function hotPathText(trace: BlackBoxTrace, width: number): string {
  const labels = trace.hotPathNodeIds
    .map((id) => trace.nodes.find((node) => node.id === id))
    .filter((node): node is BlackBoxNode => Boolean(node))
    .slice(0, 5)
    .map((node) => `${nodeGlyph(node)} ${node.label}`);
  return truncate(`Hot path: ${labels.join('  ->  ') || 'no hot path'}`, width);
}

export function createBlackBoxPanel(
  state: BlackBoxPanelState,
  trace: BlackBoxTrace | null,
  contentWidth: number = BLACKBOX_MAX_CONTENT_WIDTH,
) {
  const width = Math.max(40, contentWidth);

  if (!trace || !trace.target) {
    return Box(
      {
        flexDirection: 'column',
        width: '100%',
        flexGrow: 1,
        borderStyle: 'single',
        borderColor: COLORS.magenta,
        paddingLeft: 1,
        paddingRight: 1,
      },
      Text({ content: ' Black Box ', fg: COLORS.magenta, attributes: BOLD }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: 'No event-level sessions found in this window.', fg: COLORS.dimWhite }),
      Text({ content: 'Black Box needs provider logs with events, sessions, and token/cost data.', fg: COLORS.dimWhite }),
      Text({ content: 'Run local AI tools, refresh, then open Black Box again.', fg: COLORS.dimWhite }),
    );
  }

  const graphWidth = width >= 92 ? Math.floor(width * 0.58) : width;
  const inspectorWidth = width >= 92 ? Math.max(28, width - graphWidth - 4) : width;
  const graph = graphLines(trace, state, graphWidth);
  const inspector = inspectorLines(trace, state, inspectorWidth);
  const rows = width >= 92
    ? combineColumns(graph, inspector, graphWidth, inspectorWidth)
    : [...graph, { nodeId: null, text: '─'.repeat(Math.min(width, 72)), fg: COLORS.magenta }, ...inspector];

  const title = ` Black Box: ${trace.target.label} · ${trace.target.date} `;
  const stats = `Events ${trace.summary.totalEvents} · ${formatTokens(trace.summary.totalTokens)} · ${formatCost(trace.summary.totalCost)} · cache ${formatPercent(trace.summary.cacheHitRate)} · switches ${trace.summary.modelSwitches}`;
  const controls = 'j/k node · h/l trace · f focus · enter details · r refresh';

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.magenta,
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({ content: truncate(title, width), fg: COLORS.magenta, attributes: BOLD }),
    Text({ content: truncate(stats, width), fg: COLORS.green, attributes: BOLD }),
    Text({ content: '', fg: COLORS.dimWhite }),
    ...rows.map((line) => Text({
      content: truncate(line.text, width),
      fg: line.fg,
      attributes: line.bold ? BOLD : undefined,
    })),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: hotPathText(trace, width), fg: COLORS.amber, attributes: BOLD }),
    ...(trace.wasteNodeIds.length > 0
      ? [Text({ content: truncate(`Waste markers: ${trace.wasteNodeIds.length} red node${trace.wasteNodeIds.length === 1 ? '' : 's'}`, width), fg: COLORS.red, attributes: BOLD })]
      : []),
    ...(trace.warnings.length > 0
      ? [Text({ content: truncate(`Warnings: ${trace.warnings.join(' | ')}`, width), fg: COLORS.dimWhite })]
      : []),
    Text({ content: truncate(controls, width), fg: COLORS.dimWhite }),
  );
}
