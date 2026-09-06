import { Box, Text } from '@opentui/core';
import { quotaLines } from '@tokenleak/renderers';
import type { AppState } from '../lib/state';
import { COLORS, BOLD } from '../lib/theme';

/** Content height after the global header, footer and optional Cursor banner. */
export function quotaPanelHeight(terminalHeight: number, hasCursorBanner: boolean): number {
  return Math.max(0, terminalHeight - 2 - Number(hasCursorBanner));
}

/** Account capacity view; remains usable when no historical logs exist. */
export function createQuotasPanel(state: AppState, width = 80, height = 20) {
  const lines = state.quotaSnapshot
    ? quotaLines(state.quotaSnapshot)
    : [
        'SUBSCRIPTION QUOTAS',
        state.quotasLoading ? 'Checking provider quotas...' : 'Press r to check provider quotas.',
      ];
  if (state.quotasLoading && state.quotaSnapshot)
    lines.splice(1, 0, 'Refreshing... showing last check');
  if (state.quotasError) lines.splice(1, 0, state.quotasError);
  lines.push('r: refresh  j/k: scroll  |  Readings cached up to 60s; refresh cooldown 15s.');
  const contentWidth = Math.max(10, width - 4);
  const wrapped = lines.flatMap((line) => {
    if (!line) return [''];
    const result: string[] = [];
    for (let start = 0; start < line.length; start += contentWidth)
      result.push(line.slice(start, start + contentWidth));
    return result;
  });
  const visible = Math.max(0, height - 3);
  const offset = Math.min(state.quotasScrollOffset, Math.max(0, wrapped.length - visible));
  state.quotasScrollOffset = offset;
  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
      paddingLeft: 1,
      paddingRight: 1,
    },
    ...wrapped.slice(offset, offset + visible).map((content) =>
      Text({
        content,
        height: 1,
        flexShrink: 0,
        fg:
          content.includes('STALE') ||
          content.includes('unavailable') ||
          content.includes('rejected')
            ? COLORS.amber
            : COLORS.white,
        ...(content === 'SUBSCRIPTION QUOTAS' ? { attributes: BOLD } : {}),
      }),
    ),
    Text({
      content:
        ` Lines ${offset + 1}–${Math.min(offset + visible, wrapped.length)} / ${wrapped.length} · j/k scroll · r refresh`.slice(
          0,
          contentWidth,
        ),
      height: 1,
      flexShrink: 0,
      fg: COLORS.cyan,
    }),
  );
}
