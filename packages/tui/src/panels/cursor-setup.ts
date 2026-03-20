import { Box, InputRenderable, InputRenderableEvents, RenderableEvents, Text } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { getCursorCredentialsPath, type CursorSetupStatus } from '@tokenleak/registry';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState, CursorSetupField } from '../lib/state.js';

export const CURSOR_SESSION_COOKIE_NAME = 'WorkosCursorSessionToken';

export interface CursorSetupCallbacks {
  onFieldFocus: (field: CursorSetupField) => void;
  onLabelInput: (value: string) => void;
  onTokenInput: (value: string) => void;
  onSubmit: () => void;
}

export interface CursorSetupPanel {
  panel: ReturnType<typeof Box>;
  labelInput: InputRenderable;
  tokenInput: InputRenderable;
}

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

function renderField(label: string, input: InputRenderable) {
  return Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 2, paddingRight: 2 },
    Text({ content: `${label}: `, fg: COLORS.cyan, attributes: BOLD }),
    input,
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

function isErrorMessage(state: AppState): boolean {
  const status = getCursorStatus(state);
  const statusError = status?.error ?? '';
  const message = state.cursorSetupMessage ?? statusError;
  return message.toLowerCase().includes('error')
    || message.toLowerCase().includes('invalid')
    || message.toLowerCase().includes('expired')
    || message.toLowerCase().includes('failed');
}

export function getCursorSetupInstructions(status: CursorSetupStatus | null): string[] {
  const lines = [
    '1. Sign in to Cursor and open https://www.cursor.com/settings',
    '2. Open browser devtools, then go to Application (or Storage) > Cookies > https://www.cursor.com',
    `3. Copy the ${CURSOR_SESSION_COOKIE_NAME} cookie value and paste it here`,
    '4. Press Enter in the token field to validate, save, and sync usage CSVs',
    `5. Tokenleak stores the token in plaintext at ${getCursorCredentialsPath()}`,
    `6. Browser labels vary, but ${CURSOR_SESSION_COOKIE_NAME} is the cookie name to look for`,
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
    : 'Tab: token field  Enter on token: validate/save/sync  Esc: close';
}

function createFieldInput(
  renderer: CliRenderer,
  value: string,
  placeholder: string,
  field: CursorSetupField,
  onInput: (value: string) => void,
  onFieldFocus: (field: CursorSetupField) => void,
): InputRenderable {
  const input = new InputRenderable(renderer, {
    width: '100%',
    flexGrow: 1,
    value,
    placeholder,
    backgroundColor: COLORS.bg,
    focusedBackgroundColor: COLORS.blue,
    textColor: COLORS.white,
    focusedTextColor: COLORS.white,
    placeholderColor: COLORS.dimWhite,
  });

  input.on(InputRenderableEvents.INPUT, onInput);
  input.on(RenderableEvents.FOCUSED, () => onFieldFocus(field));

  return input;
}

export function createCursorSetupPanel(
  state: AppState,
  renderer: CliRenderer,
  callbacks: CursorSetupCallbacks,
): CursorSetupPanel {
  const status = getCursorStatus(state);
  const message = state.cursorSetupMessage ?? status?.error ?? null;
  const isError = isErrorMessage(state);
  const title = status?.state === 'needs_reauth'
    ? ' Cursor Re-authentication '
    : ' Cursor Setup ';
  const labelInput = createFieldInput(
    renderer,
    state.cursorSetupLabel,
    '(optional)',
    'label',
    callbacks.onLabelInput,
    callbacks.onFieldFocus,
  );
  const tokenInput = createFieldInput(
    renderer,
    state.cursorSetupToken,
    `(paste ${CURSOR_SESSION_COOKIE_NAME})`,
    'token',
    callbacks.onTokenInput,
    callbacks.onFieldFocus,
  );

  labelInput.on(InputRenderableEvents.ENTER, () => {
    callbacks.onFieldFocus('token');
    tokenInput.focus();
  });
  tokenInput.on(InputRenderableEvents.ENTER, callbacks.onSubmit);

  return {
    labelInput,
    tokenInput,
    panel: Box(
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
      ...getCursorSetupInstructions(status).map((line) => Text({ content: `  ${line}`, fg: COLORS.white })),
      Text({ content: '', fg: COLORS.dimWhite }),
      renderField('Label', labelInput),
      Text({ content: '', fg: COLORS.dimWhite }),
      renderField('Token', tokenInput),
      Text({ content: '', fg: COLORS.dimWhite }),
      buildStatusLine(
        state.cursorSetupSubmitting ? 'Validating token and syncing Cursor cache...' : message,
        isError,
      ),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: `  ${hintForField(state.cursorSetupField)}`, fg: COLORS.dimWhite }),
    ),
  };
}
