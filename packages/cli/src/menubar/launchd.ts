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

export function buildClaudeStatuslineBridge(paths: MenubarPaths): string {
  const snapshotPath = shellQuote(paths.claudeSnapshotPath);
  const originalCmd = shellQuote(paths.previousClaudeStatuslineCommandPath);

  // Self-contained bridge: uses /usr/bin/python3 (pre-installed on macOS 12.3+)
  // to extract rate_limits from Claude Code's statusline JSON and atomic-write
  // the snapshot file. The python3 process runs in the background so the user's
  // original statusline command renders with zero added latency.
  return `#!/bin/zsh
set -u
SNAPSHOT_PATH=${snapshotPath}
ORIGINAL_CMD=${originalCmd}

tmp_file=$(mktemp "\${TMPDIR:-/tmp}/tl-claude-sl.XXXXXX")
cat > "$tmp_file"

# Background: extract rate_limits and write snapshot atomically
(/usr/bin/python3 -c '
import json, sys, os, tempfile
from datetime import datetime, timezone

snap_path = sys.argv[1]
input_path = sys.argv[2]

try:
    with open(input_path) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)

rl = data.get("rate_limits") or data.get("rateLimits")
if not isinstance(rl, dict):
    sys.exit(0)

def parse_window(w, fallback_min):
    if not isinstance(w, dict):
        return None
    pct = w.get("used_percentage") or w.get("usedPercent") or w.get("used_percent")
    if not isinstance(pct, (int, float)):
        return None
    reset = w.get("resets_at") or w.get("resetAt") or w.get("reset_at")
    reset_iso = None
    if isinstance(reset, (int, float)) and reset > 0:
        reset_iso = datetime.fromtimestamp(reset, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    elif isinstance(reset, str) and reset:
        reset_iso = reset
    wm = w.get("window_minutes") or w.get("windowMinutes") or fallback_min
    return {"usedPercent": pct, "windowMinutes": wm if isinstance(wm, int) else fallback_min, "resetAt": reset_iso}

five = parse_window(rl.get("five_hour") or rl.get("fiveHour"), 300)
seven = parse_window(rl.get("seven_day") or rl.get("sevenDay"), 10080)

if not five and not seven:
    sys.exit(0)

plan = None
for k in ("subscription_type", "subscriptionType", "plan_type"):
    v = data.get(k)
    if isinstance(v, str) and v.strip():
        plan = v.strip()
        break
if plan is None:
    acct = data.get("account")
    if isinstance(acct, dict):
        v = acct.get("subscription_type")
        if isinstance(v, str) and v.strip():
            plan = v.strip()

snapshot = {
    "schemaVersion": 1,
    "source": "claude-statusline",
    "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "planType": plan,
    "fiveHour": five,
    "sevenDay": seven,
}

snap_dir = os.path.dirname(snap_path)
os.makedirs(snap_dir, exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=snap_dir, suffix=".tmp")
try:
    with os.fdopen(fd, "w") as out:
        json.dump(snapshot, out, indent=2)
        out.write("\\n")
    os.rename(tmp, snap_path)
except Exception:
    try:
        os.unlink(tmp)
    except Exception:
        pass
' "$SNAPSHOT_PATH" "$tmp_file"
rm -f "$tmp_file") 2>/dev/null &

# Forward to user's original statusline command immediately (no delay)
if [ -x "$ORIGINAL_CMD" ]; then
  exec "$ORIGINAL_CMD" < "$tmp_file"
fi
exit 0
`;
}

export function buildOriginalClaudeStatuslineCommandScript(command: string): string {
  return `#!/bin/zsh
${command}
`;
}
