import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Box, TextAttributes } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import type { CapturedFrame, CapturedSpan } from '@opentui/core/types';
import type { CliRenderer } from '@opentui/core';
import type { TokenleakOutput } from '@tokenleak/core';
import { computeAchievements } from '@tokenleak/renderers';
import { SCHEMA_VERSION } from '../packages/core/dist/index.js';
import { buildHeader } from '../packages/tui/dist/panels/header.js';
import { createChartPanel } from '../packages/tui/dist/panels/chart-panel.js';
import { createStatsRow } from '../packages/tui/dist/panels/stats-row.js';
import { createModelList } from '../packages/tui/dist/panels/model-list.js';
import { buildStatusBar } from '../packages/tui/dist/panels/status-bar.js';
import { createMatrixView } from '../packages/tui/dist/panels/bloomberg.js';
import { createAdvisorPanel } from '../packages/tui/dist/panels/advisor.js';
import { createFocusPanel } from '../packages/tui/dist/panels/focus.js';
import { createExplainPanel } from '../packages/tui/dist/panels/explain.js';
import { createComparePanel } from '../packages/tui/dist/panels/compare.js';
import { createExportPanel } from '../packages/tui/dist/panels/export.js';
import { createWrappedPanel } from '../packages/tui/dist/panels/wrapped.js';
import {
  loadAllData,
  getDailyForWindow,
  ensureAdvisorReport,
  ensureFocusReport,
  ensureExplainReport,
  ensureCompareOutput,
  ensureMoreStats,
} from '../packages/tui/dist/lib/data.js';
import { createInitialState, WINDOW_DAYS } from '../packages/tui/dist/lib/state.js';
import type { AppState, ViewMode } from '../packages/tui/dist/lib/state.js';
import { COLORS } from '../packages/tui/dist/lib/theme.js';

const OUTPUT_DIR = join(process.cwd(), 'docs');
const SCREEN_WIDTH = 152;
const SCREEN_HEIGHT = 44;
const CELL_WIDTH = 8.6;
const CELL_HEIGHT = 18;
const INNER_PADDING = 26;
const TITLEBAR_HEIGHT = 34;

interface ViewCapture {
  mode: ViewMode;
  output: string;
  title: string;
  configure?: (state: AppState) => void;
}

const VIEW_CAPTURES: ViewCapture[] = [
  { mode: 'overview', output: 'tui-overview.png', title: 'Overview' },
  {
    mode: 'matrix',
    output: 'tui-matrix.png',
    title: 'Matrix',
    configure: (state) => {
      state.matrixPage = 3;
    },
  },
  { mode: 'advisor', output: 'tui-advisor.png', title: 'Advisor' },
  { mode: 'focus', output: 'tui-focus.png', title: 'Focus' },
  { mode: 'explain', output: 'tui-explain.png', title: 'Explain' },
  { mode: 'compare', output: 'tui-compare.png', title: 'Compare' },
  {
    mode: 'export',
    output: 'tui-export.png',
    title: 'Export',
    configure: (state) => {
      state.exportStatus = 'Ready: export PNG, Wrapped PNG, or launch Wrapped Live';
    },
  },
  { mode: 'wrapped', output: 'tui-wrapped.png', title: 'Wrapped' },
];

function clearRoot(renderer: CliRenderer): void {
  const children = renderer.root.getChildren();
  for (const child of children) {
    renderer.root.remove(child.id);
  }
}

function buildTokenleakOutput(state: AppState): TokenleakOutput | null {
  if (!state.data || state.data.windows.length === 0) {
    return null;
  }

  const windowStats = state.data.windows[state.selectedWindowIndex]?.stats;
  if (!windowStats) {
    return null;
  }

  const days = WINDOW_DAYS[state.selectedWindowIndex];
  const today = new Date().toISOString().slice(0, 10);
  const dateRange = days && days > 0
    ? {
        since: (() => {
          const date = new Date();
          date.setDate(date.getDate() - (days - 1));
          return date.toISOString().slice(0, 10);
        })(),
        until: today,
      }
    : state.data.dateRange;

  const output: TokenleakOutput = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange,
    providers: state.data.providers,
    aggregated: windowStats,
  };

  const more = ensureMoreStats(state);
  if (more) {
    (output as TokenleakOutput & { more?: unknown }).more = more;
  }

  return output;
}

function buildContent(state: AppState): ReturnType<typeof Box> {
  const windowStats = state.data?.windows[state.selectedWindowIndex]?.stats ?? null;
  const daily = state.data ? getDailyForWindow(state.data, state.selectedWindowIndex) : [];

  switch (state.selectedView) {
    case 'overview':
      return Box(
        { flexDirection: 'column', width: '100%', flexGrow: 1 },
        createChartPanel(state, daily),
        createStatsRow(state, windowStats),
        createModelList(state, windowStats),
      );
    case 'matrix':
      return createMatrixView(state);
    case 'advisor':
      return createAdvisorPanel(state, ensureAdvisorReport(state));
    case 'focus':
      return createFocusPanel(state, ensureFocusReport(state));
    case 'explain':
      return createExplainPanel(ensureExplainReport(state), state.explainDate);
    case 'compare':
      return createComparePanel(state, ensureCompareOutput(state));
    case 'export':
      return createExportPanel(state);
    case 'wrapped': {
      const output = buildTokenleakOutput(state);
      const achievements = output ? computeAchievements(output) : [];
      const providers = state.data?.providers.map((provider) => ({
        displayName: provider.displayName,
        totalTokens: provider.totalTokens,
        totalCost: provider.totalCost,
      })) ?? [];
      return createWrappedPanel(
        windowStats,
        achievements,
        providers,
        state.wrappedScrollOffset,
        ensureMoreStats(state),
      );
    }
    default:
      return Box({ flexDirection: 'column', width: '100%', flexGrow: 1 });
  }
}

function buildLayout(state: AppState, renderer: CliRenderer) {
  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: COLORS.bg,
    },
    buildHeader(state, renderer),
    buildContent(state),
    buildStatusBar(state),
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sanitizeDisplayText(value: string): string {
  return value
    .replaceAll(/\p{Extended_Pictographic}/gu, '*')
    .replaceAll(/\uFE0F/gu, '');
}

function rgbaToCss(color: { buffer: ArrayLike<number> }): string {
  const red = Math.round((color.buffer[0] ?? 0) * 255);
  const green = Math.round((color.buffer[1] ?? 0) * 255);
  const blue = Math.round((color.buffer[2] ?? 0) * 255);
  const alpha = Math.max(0, Math.min(1, color.buffer[3] ?? 1));
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
}

function getTextOpacity(span: CapturedSpan): number {
  const alpha = Math.max(0, Math.min(1, span.fg.buffer[3] ?? 1));
  const isDim = (span.attributes & TextAttributes.DIM) !== 0;
  return isDim ? Math.max(0.45, alpha * 0.72) : alpha;
}

function renderLine(line: CapturedFrame['lines'][number], y: number): string {
  let xCells = 0;
  const parts: string[] = [];

  for (const span of line.spans) {
    const spanWidth = span.width * CELL_WIDTH;
    const x = INNER_PADDING + (xCells * CELL_WIDTH);
    const bg = rgbaToCss(span.bg);
    const fg = rgbaToCss(span.fg);
    const fontWeight = (span.attributes & TextAttributes.BOLD) !== 0 ? 700 : 500;
    const safeText = escapeXml(sanitizeDisplayText(span.text));

    parts.push(
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${spanWidth.toFixed(2)}" height="${CELL_HEIGHT}" fill="${bg}" />`,
    );

    if (span.text.trim().length > 0 || span.text.includes(' ')) {
      parts.push(
        `<text x="${x.toFixed(2)}" y="${(y + (CELL_HEIGHT * 0.76)).toFixed(2)}" fill="${fg}" fill-opacity="${getTextOpacity(span).toFixed(3)}" font-family="SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace" font-size="13.5" font-weight="${fontWeight}" xml:space="preserve">${safeText}</text>`,
      );
    }

    xCells += span.width;
  }

  return parts.join('');
}

function frameToSvg(frame: CapturedFrame, title: string): string {
  const screenWidthPx = frame.cols * CELL_WIDTH;
  const screenHeightPx = frame.rows * CELL_HEIGHT;
  const width = Math.ceil(screenWidthPx + (INNER_PADDING * 2));
  const height = Math.ceil(screenHeightPx + (INNER_PADDING * 2) + TITLEBAR_HEIGHT);
  const terminalY = INNER_PADDING + TITLEBAR_HEIGHT;
  const lines = frame.lines
    .map((line, index) => renderLine(line, terminalY + (index * CELL_HEIGHT)))
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    '<defs>',
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">',
    '<feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity="0.38" />',
    '</filter>',
    '</defs>',
    '<rect width="100%" height="100%" fill="#050505" />',
    `<rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="18" fill="#0b0b0b" filter="url(#shadow)" />`,
    `<rect x="12" y="12" width="${width - 24}" height="${TITLEBAR_HEIGHT + 12}" rx="18" fill="#101010" />`,
    `<rect x="12" y="${12 + TITLEBAR_HEIGHT}" width="${width - 24}" height="${height - 36 - TITLEBAR_HEIGHT}" fill="${COLORS.bg}" />`,
    '<circle cx="34" cy="29" r="6" fill="#ff5f57" />',
    '<circle cx="54" cy="29" r="6" fill="#febc2e" />',
    '<circle cx="74" cy="29" r="6" fill="#28c840" />',
    `<text x="${(width / 2).toFixed(2)}" y="33" fill="#cfcfcf" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="600" text-anchor="middle">tokenleak • ${escapeXml(title)}</text>`,
    lines,
    '</svg>',
  ].join('');
}

async function captureView(renderer: CliRenderer, state: AppState, title: string): Promise<CapturedFrame> {
  clearRoot(renderer);
  renderer.root.add(buildLayout(state, renderer));
  renderer.requestRender();
  await renderer.loop();
  await renderer.loop();
  const currentBuffer = renderer.currentRenderBuffer;
  const cursorState = renderer.getCursorState();
  return {
    cols: currentBuffer.width,
    rows: currentBuffer.height,
    cursor: [cursorState.x, cursorState.y],
    lines: currentBuffer.getSpanLines(),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const data = await loadAllData();
  if (data.providers.length === 0) {
    throw new Error('No provider data found. Generate some Tokenleak data before capturing screenshots.');
  }

  const { renderer } = await createTestRenderer({
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: COLORS.bg,
  });

  try {
    for (const capture of VIEW_CAPTURES) {
      const state = createInitialState();
      state.isLoading = false;
      state.data = data;
      state.selectedWindowIndex = 3;
      state.selectedView = capture.mode;
      state.cursorSetupStatusOverride = {
        state: 'ready',
        hasCredentials: true,
        hasCache: true,
      };

      capture.configure?.(state);

      const frame = await captureView(renderer, state, capture.title);
      const svg = frameToSvg(frame, capture.title);
      const buffer = await sharp(Buffer.from(svg))
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      const outputPath = join(OUTPUT_DIR, capture.output);
      writeFileSync(outputPath, buffer);
      console.log(`wrote ${outputPath}`);
    }
  } finally {
    renderer.destroy();
  }
}

await main();
