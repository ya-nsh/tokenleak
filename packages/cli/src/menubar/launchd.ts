import type { MenubarPaths } from './types.js';
import { MENUBAR_APP_LABEL } from './paths.js';
import { shellQuote } from './format.js';

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function renderStringArray(values: string[]): string {
  return values.map((value) => `    <string>${xmlEscape(value)}</string>`).join('\n');
}

export function buildAppPlist(paths: MenubarPaths): string {
  const executablePath = `${paths.installedAppPath}/Contents/MacOS/Tokenleak Usage`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MENUBAR_APP_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${renderStringArray([executablePath])}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENLEAK_MENUBAR_HOME</key>
    <string>${xmlEscape(paths.homeDir)}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(paths.appSupportDir)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(paths.appLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(paths.appLogPath)}</string>
</dict>
</plist>
`;
}

export function buildCliWrapper(processExecPath: string, cliEntrypoint: string): string {
  return `#!/bin/zsh
exec ${shellQuote(processExecPath)} ${shellQuote(cliEntrypoint)} "$@"
`;
}

export function buildDashboardWrapper(paths: MenubarPaths): string {
  return `#!/bin/zsh
exec ${shellQuote(paths.cliWrapperPath)} --provider codex,claude-code "$@"
`;
}

export function buildClaudeStatuslineWrapper(paths: MenubarPaths): string {
  return `#!/bin/zsh
set -u
tmp_file=$(mktemp "\${TMPDIR:-/tmp}/tokenleak-claude-statusline.XXXXXX")
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT
cat > "$tmp_file"
${shellQuote(paths.cliWrapperPath)} menubar claude-statusline --home ${shellQuote(paths.homeDir)} < "$tmp_file" >/dev/null 2>/dev/null || true
if [ -x ${shellQuote(paths.previousClaudeStatuslineCommandPath)} ]; then
  exec ${shellQuote(paths.previousClaudeStatuslineCommandPath)} < "$tmp_file"
fi
exit 0
`;
}

export function buildOriginalClaudeStatuslineCommandScript(command: string): string {
  return `#!/bin/zsh
${command}
`;
}
