import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { TextAttributes } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import type { CapturedFrame, CapturedSpan } from '@opentui/core/types';
import type { CliRenderer } from '@opentui/core';
import { buildLayout } from '../packages/tui/dist/index.js';
import {
  loadAllData,
  ensureSavingsReport,
  ensureFocusReport,
  ensureExplainReport,
  ensureCompareOutput,
  ensureMoreStats,
} from '../packages/tui/dist/lib/data.js';
import { filterOptionsOf } from '../packages/tui/dist/lib/engine-core.js';
import { createInitialState } from '../packages/tui/dist/lib/state.js';
import type { AppState, ViewMode } from '../packages/tui/dist/lib/state.js';
import { COLORS } from '../packages/tui/dist/lib/theme.js';

/** Where PNGs go; set TOKENLEAK_SCREENSHOT_DIR to keep docs/ untouched. */
const OUTPUT_DIR = process.env['TOKENLEAK_SCREENSHOT_DIR'] ?? join(process.cwd(), 'docs');
const SCREEN_WIDTH = 152;
const SCREEN_HEIGHT = 44;
const CELL_WIDTH = 8.6;
const CELL_HEIGHT = 18;
const INNER_PADDING = 26;
const TITLEBAR_HEIGHT = 34;
/** Palette query that lists the drill-down filters. */
const DRILLDOWN_PALETTE_QUERY = 'only ';

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
  {
    mode: 'overview',
    output: 'tui-palette.png',
    title: 'Command palette',
    configure: (state) => {
      // Same query `f` opens on the Overview: the provider/model drill-downs.
      state.palette = { query: DRILLDOWN_PALETTE_QUERY, selected: 0 };
    },
  },
];

/** Builds every report a capture shows up front, so no view waits on the engine. */
function prepareReports(state: AppState): void {
  ensureSavingsReport(state);
  ensureFocusReport(state);
  ensureExplainReport(state);
  ensureCompareOutput(state);
  ensureMoreStats(state);
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

/** Fill fraction of each lower-eighth block, drawn as a rect so stacks read like a terminal. */
const LOWER_BLOCKS: Record<string, number> = { '▁': 1, '▂': 2, '▃': 3, '▄': 4, '▅': 5, '▆': 6, '▇': 7, '█': 8 };
/** Fill fraction of each left-eighth block (share bars). */
const LEFT_BLOCKS: Record<string, number> = { '▏': 1, '▎': 2, '▍': 3, '▌': 4, '▋': 5, '▊': 6, '▉': 7 };

function renderBlockChar(char: string, x: number, y: number, fg: string): string | null {
  const lower = LOWER_BLOCKS[char];
  if (lower !== undefined) {
    const height = (CELL_HEIGHT * lower) / 8;
    // Half a pixel of overlap hides seams between neighbouring cells.
    return `<rect x="${x.toFixed(2)}" y="${(y + CELL_HEIGHT - height).toFixed(2)}" width="${(CELL_WIDTH + 0.5).toFixed(2)}" height="${(height + 0.5).toFixed(2)}" fill="${fg}" />`;
  }
  const left = LEFT_BLOCKS[char];
  if (left !== undefined) {
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${((CELL_WIDTH * left) / 8 + 0.5).toFixed(2)}" height="${CELL_HEIGHT + 0.5}" fill="${fg}" />`;
  }
  return null;
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

    parts.push(
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${spanWidth.toFixed(2)}" height="${CELL_HEIGHT}" fill="${bg}" />`,
    );

    // Draw cell by cell so box-drawing and block glyphs sit on the grid
    // regardless of the font's advance width.
    const chars = [...span.text];
    chars.forEach((char, index) => {
      const cellX = x + index * CELL_WIDTH;
      const block = renderBlockChar(char, cellX, y, fg);
      if (block) {
        parts.push(block);
        return;
      }
      if (char.trim().length === 0) return;
      parts.push(
        `<text x="${cellX.toFixed(2)}" y="${(y + (CELL_HEIGHT * 0.76)).toFixed(2)}" fill="${fg}" fill-opacity="${getTextOpacity(span).toFixed(3)}" font-family="SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace" font-size="13.5" font-weight="${fontWeight}" textLength="${CELL_WIDTH.toFixed(2)}" lengthAdjust="spacingAndGlyphs">${escapeXml(sanitizeDisplayText(char))}</text>`,
      );
    });

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

async function captureView(renderer: CliRenderer, state: AppState, _title: string): Promise<CapturedFrame> {
  for (const child of renderer.root.getChildren()) child.destroyRecursively();
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

  const loaded = await loadAllData();
  if (loaded.providers.length === 0) {
    throw new Error('No provider data found. Generate some Tokenleak data before capturing screenshots.');
  }
  // The engine attaches drill-down options in the app; do the same here so the
  // palette lists the provider and model filters.
  const data = { ...loaded, filterOptions: filterOptionsOf(loaded) };

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
      prepareReports(state);

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
