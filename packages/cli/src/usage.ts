import { writeFile } from 'node:fs/promises';
import type { QuotaProvider } from '@tokenleak/core';
import { quotaClient, QUOTA_PROVIDERS, type QuotaClient } from '@tokenleak/registry';
import { quotaLines } from '@tokenleak/renderers';

export const USAGE_HELP = `Usage: tokenleak usage [--json | --format terminal|json] [--provider claude,codex,copilot] [--output path] [--refresh]\n\nShow account-wide subscription capacity and reset times.\nUses existing logins; does not modify credentials. No history/date filters apply.\nUnsupported providers are rejected. Partial provider failures appear in the output.\n--refresh bypasses the 60-second cache, subject to cooldowns.\n`;
/** Validate all arguments before accessing credentials or network. */
export function parseUsageArgs(args: string[]) {
  let format = 'terminal';
  let providers = [...QUOTA_PROVIDERS];
  let output: string | undefined;
  let refresh = false;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      format = 'json';
      continue;
    }
    if (arg === '--refresh') {
      refresh = true;
      continue;
    }
    if (!['--format', '--provider', '--output', '-o'].includes(arg))
      throw new Error(`Unknown usage option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--format') format = value;
    else if (arg === '--output' || arg === '-o') output = value;
    else {
      const names = value
        .split(',')
        .map((name) => (name.trim() === 'claude-code' ? 'claude' : name.trim()));
      if (names.some((name) => !QUOTA_PROVIDERS.includes(name as QuotaProvider)))
        throw new Error('Quota providers: claude, codex, copilot.');
      providers = [...new Set(names)] as QuotaProvider[];
    }
  }
  if (!['terminal', 'json'].includes(format))
    throw new Error('Usage format must be terminal or json.');
  return { format, providers, output, refresh, help };
}
/** Run the quota-only command without loading historical usage or pricing. */
export async function runUsage(args: string[], client: QuotaClient = quotaClient): Promise<void> {
  const options = parseUsageArgs(args);
  if (options.help) {
    process.stdout.write(USAGE_HELP);
    return;
  }
  const snapshot = await client.load(options.providers, options.refresh);
  const text =
    (options.format === 'json'
      ? JSON.stringify(snapshot, null, 2)
      : quotaLines(snapshot).join('\n')) + '\n';
  if (options.output) await writeFile(options.output, text, { mode: 0o600 });
  else process.stdout.write(text);
}
