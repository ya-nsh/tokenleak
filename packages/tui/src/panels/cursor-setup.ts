import { Box, Text } from '@opentui/core';
import { getCursorCredentialsPath, type CursorSetupStatus } from '@tokenleak/registry';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState, CursorSetupField } from '../lib/state.js';

function getCursorStatus(state: AppState): CursorSetupStatus | null {
  return state.cursorSetupStatusOverride ?? state.data?.cursorSetupStatus ?? null;
}

export function getCursorBannerText(state: AppState): string | null {
  const status = getCursorStatus(state);
  if (!status || status.state === 'ready') {
    return null;
  }

  switch (status.state) {
    case 'needs_auth':
      return 'Cursor not connected. Press c to connect.';
    case 'needs_reauth':
      return 'Cursor session expired. Press c to update token.';
    case 'sync_failed_cached':
      return 'Cursor sync failed, using cached data. Press c for details.';
    case 'needs_sync':
      return 'Cursor needs a local usage sync. Press c to retry.';
    default:
      return null;
  }
}

export function buildCursorBanner(state: AppState) {
  const text = getCursorBannerText(state);
  if (!text) {
    return null;
  }

  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      paddingLeft: 1,
      paddingRight: 1,
      height: 1,
    },
    Text({ content: text, fg: COLORS.amber, attributes: BOLD }),
  );
}

function renderField(label: string, value: string, isFocused: boolean, placeholder: string, masked = false) {
  const displayValue = value.length > 0
    ? (masked ? '*'.repeat(Math.min(value.length, 48)) : value)
    : placeholder;
  return Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 2, paddingRight: 2 },
    Text({ content: `${label}: `, fg: COLORS.cyan, attributes: BOLD }),
    Text({
      content: displayValue,
      fg: value.length > 0 ? COLORS.white : COLORS.dimWhite,
      bg: isFocused ? COLORS.blue : undefined,
      attributes: isFocused ? BOLD : undefined,
    }),
  );
}

function buildStatusLine(message: string | null, isError: boolean) {
  if (!message) {
    return Text({ content: '', fg: COLORS.dimWhite });
  }

  return Text({
    content: `  ${message}`,
    fg: isError ? COLORS.red : COLORS.green,
    attributes: BOLD,
  });
}

function getMessageKind(state: AppState): boolean {
  const status = getCursorStatus(state);
  const statusError = status?.error ?? '';
  const message = state.cursorSetupMessage ?? statusError;
  return message.toLowerCase().includes('error')
    || message.toLowerCase().includes('invalid')
    || message.toLowerCase().includes('expired')
    || message.toLowerCase().includes('failed');
}

function getInstructions(status: CursorSetupStatus | null): string[] {
  const lines = [
    '1. Sign in to Cursor and open https://www.cursor.com/settings',
    '2. Open browser devtools, inspect a request to cursor.com, and copy the session token',
    '3. Paste the token here, then press Enter to validate, save, and sync usage CSVs',
    `4. Tokenleak stores the token in plaintext at ${getCursorCredentialsPath()}`,
  ];

  if (!status) {
    return lines;
  }

  if (status.state === 'sync_failed_cached' || status.state === 'needs_sync') {
    return [
      'Press Enter to retry the Cursor usage sync for the active account.',
      'If the retry still fails because the session is expired, replace the token below.',
      ...lines,
    ];
  }

  if (status.state === 'needs_reauth') {
    return [
      'The saved Cursor session is no longer valid.',
      ...lines,
    ];
  }

  return lines;
}

function hintForField(field: CursorSetupField): string {
  return field === 'token'
    ? 'Tab: label field  Enter: validate/save/sync  Esc: close'
    : 'Tab: token field  Enter: validate/save/sync  Esc: close';
}

export function createCursorSetupPanel(state: AppState) {
  const status = getCursorStatus(state);
  const message = state.cursorSetupMessage ?? status?.error ?? null;
  const isError = getMessageKind(state);
  const title = status?.state === 'needs_reauth'
    ? ' Cursor Re-authentication '
    : ' Cursor Setup ';

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.amber,
      padding: 1,
    },
    Text({ content: title, fg: COLORS.amber, attributes: BOLD }),
    Text({ content: '', fg: COLORS.dimWhite }),
    ...getInstructions(status).map((line) => Text({ content: `  ${line}`, fg: COLORS.white })),
    Text({ content: '', fg: COLORS.dimWhite }),
    renderField('Label', state.cursorSetupLabel, state.cursorSetupField === 'label', '(optional)', false),
    Text({ content: '', fg: COLORS.dimWhite }),
    renderField('Token', state.cursorSetupToken, state.cursorSetupField === 'token', '(paste session token)', true),
    Text({ content: '', fg: COLORS.dimWhite }),
    buildStatusLine(
      state.cursorSetupSubmitting ? 'Validating token and syncing Cursor cache...' : message,
      isError,
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: `  ${hintForField(state.cursorSetupField)}`, fg: COLORS.dimWhite }),
  );
}
