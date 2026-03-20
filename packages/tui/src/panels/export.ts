import { Box, Text } from '@opentui/core';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

interface ExportOption {
  key: string;
  label: string;
  description: string;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    key: 'p',
    label: 'Export PNG',
    description: 'Render a terminal-card PNG and save to tokenleak.png',
  },
  {
    key: 'w',
    label: 'Wrapped PNG',
    description: 'Generate the AI Wrapped infographic and save to tokenleak-wrapped.png',
  },
  {
    key: 'l',
    label: 'Wrapped Live',
    description: 'Launch the AI Wrapped presentation in your browser',
  },
];

function renderOption(opt: ExportOption, isDisabled: boolean) {
  return Box(
    { flexDirection: 'column', width: '100%', paddingLeft: 2, paddingRight: 1 },
    Box(
      { flexDirection: 'row', width: '100%' },
      Text({
        content: `[${opt.key}]`,
        fg: isDisabled ? COLORS.dimWhite : COLORS.amber,
        attributes: BOLD,
      }),
      Text({ content: `  ${opt.label}`, fg: isDisabled ? COLORS.dimWhite : COLORS.white, attributes: BOLD }),
    ),
    Text({
      content: `    ${opt.description}`,
      fg: COLORS.dimWhite,
    }),
    Text({ content: '', fg: COLORS.dimWhite }),
  );
}

export function createExportPanel(state: AppState) {
  const hasData = !!state.data && state.data.providers.length > 0;
  const status = state.exportStatus;

  const statusNode = status
    ? Text({
        content: `  ${status}`,
        fg: status.startsWith('Error') ? COLORS.red : COLORS.green,
        attributes: BOLD,
      })
    : null;

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({ content: ' Export ', fg: COLORS.amber, attributes: BOLD }),
    Text({ content: '', fg: COLORS.dimWhite }),
    Box(
      { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({
        content: hasData
          ? 'Press a key to export your usage data:'
          : 'No data loaded — load data first before exporting.',
        fg: hasData ? COLORS.white : COLORS.dimWhite,
      }),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    ...EXPORT_OPTIONS.map((opt) => renderOption(opt, !hasData)),
    ...(statusNode ? [statusNode] : []),
  );
}
