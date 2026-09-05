import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { QuotaProvider } from '@tokenleak/core';
import { record } from './normalize';

const execute = promisify(execFile);
/** Internal secret material; never included in snapshots. */
export interface QuotaCredential {
  token: string;
  accountId?: string;
}
/** Injectable OS boundaries for hermetic credential discovery tests. */
export interface CredentialIO {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: string;
  read(path: string): Promise<string>;
  canonical(path: string): Promise<string>;
  command(file: string, args: string[]): Promise<string>;
}
const defaultIO: CredentialIO = {
  home: homedir(),
  env: process.env,
  platform: process.platform,
  read: (path) => readFile(path, 'utf8'),
  canonical: realpath,
  command: async (file, args) =>
    (await execute(file, args, { timeout: 3000, maxBuffer: 1024 * 1024, windowsHide: true }))
      .stdout,
};
function token(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && !/[\r\n]/.test(value.trim())
    ? value.trim()
    : undefined;
}
async function jsonFile(path: string, io: CredentialIO): Promise<Record<string, unknown> | null> {
  try {
    return record(JSON.parse(await io.read(path)));
  } catch (error) {
    if (record(error).code === 'ENOENT') return null;
    throw new Error('Credential storage could not be read.');
  }
}
/** Read existing native credentials only; never refresh tokens or rewrite login files. */
export async function discoverQuotaCredential(
  provider: QuotaProvider,
  io: CredentialIO = defaultIO,
): Promise<QuotaCredential | null> {
  if (provider === 'copilot') {
    let access = token(io.env.GH_TOKEN) ?? token(io.env.GITHUB_TOKEN);
    if (!access) {
      try {
        access = token(await io.command('gh', ['auth', 'token', '--hostname', 'github.com']));
      } catch {
        return null;
      }
    }
    return access ? { token: access } : null;
  }
  const override = provider === 'claude' ? io.env.CLAUDE_CONFIG_DIR : io.env.CODEX_HOME;
  const base = resolve(override || join(io.home, provider === 'claude' ? '.claude' : '.codex'));
  let document = await jsonFile(
    join(base, provider === 'claude' ? '.credentials.json' : 'auth.json'),
    io,
  );
  if (!document && io.platform === 'darwin') {
    const service = provider === 'claude' ? 'Claude Code-credentials' : 'Codex Auth';
    if (provider === 'claude' && override) return null;
    const args = ['find-generic-password', '-s', service];
    if (provider === 'codex') {
      const canonical = await io.canonical(base).catch(() => base);
      args.push('-a', `cli|${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`);
    }
    args.push('-w');
    try {
      document = record(JSON.parse(await io.command('/usr/bin/security', args)));
    } catch {
      return null;
    }
  }
  if (provider === 'codex' && document?.auth_mode === 'apikey') return null;
  const credential = record(document?.[provider === 'claude' ? 'claudeAiOauth' : 'tokens']);
  const access = token(credential[provider === 'claude' ? 'accessToken' : 'access_token']);
  if (!access) return null;
  const accountId = provider === 'codex' ? token(credential.account_id) : undefined;
  return { token: access, ...(accountId ? { accountId } : {}) };
}
