import {
  CursorAuthError,
  getActiveCursorCredentials,
  getCursorCacheDir,
  getCursorCredentialsFor,
  getCursorCredentialsPath,
  hasCursorUsageCache,
  isCursorLoggedIn,
  listCursorAccounts,
  loadCursorCredentialsStore,
  removeAllCursorAccounts,
  removeCursorAccount,
  resetCursorProviderState,
  saveCursorCredentials,
  setActiveCursorAccount,
  shouldSyncCursorForRun,
  syncCursorCache,
  validateCursorSession,
  type CursorAccountInfo,
  type CursorCredentials,
  type CursorCredentialsStore,
  type SyncCursorResult,
  type ValidateCursorSessionResult,
} from '@tokenleak/registry';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { TokenleakError } from './errors.js';

export {
  getActiveCursorCredentials,
  getCursorCacheDir,
  getCursorCredentialsFor,
  getCursorCredentialsPath,
  hasCursorUsageCache,
  isCursorLoggedIn,
  listCursorAccounts,
  loadCursorCredentialsStore,
  removeAllCursorAccounts,
  removeCursorAccount,
  resetCursorProviderState,
  saveCursorCredentials,
  setActiveCursorAccount,
  shouldSyncCursorForRun,
  syncCursorCache,
  validateCursorSession,
};
export type {
  CursorAccountInfo,
  CursorCredentials,
  CursorCredentialsStore,
  SyncCursorResult,
  ValidateCursorSessionResult,
};

async function readSecret(prompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    const rl = createInterface({ input, output });
    try {
      return (await rl.question(prompt)).trim();
    } finally {
      rl.close();
    }
  }

  output.write(prompt);
  input.resume();
  input.setEncoding('utf8');

  if (typeof input.setRawMode === 'function') {
    input.setRawMode(true);
  }

  return await new Promise<string>((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      input.off('data', onData);
      if (typeof input.setRawMode === 'function') {
        input.setRawMode(false);
      }
      input.pause();
      output.write('\n');
    };

    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          reject(new TokenleakError('Cancelled'));
          return;
        }

        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value.trim());
          return;
        }

        if (char === '\u0008' || char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    input.on('data', onData);
  });
}

export function buildCursorHelpText(): string {
  return [
    'tokenleak cursor',
    'Manage Cursor authentication and cache sync.',
    '',
    'Usage:',
    '  tokenleak cursor login [--name <label>]',
    '  tokenleak cursor status [--name <label>]',
    '  tokenleak cursor accounts [--json]',
    '  tokenleak cursor switch <name-or-id>',
    '  tokenleak cursor logout [--name <label> | --all] [--purge-cache]',
    '  tokenleak cursor reset',
    '',
    'Notes:',
    '  Session tokens come from https://www.cursor.com/settings',
    '  Session tokens are stored in plaintext with local-only file permissions.',
    `  Credentials: ${getCursorCredentialsPath()}`,
    `  Cache: ${getCursorCacheDir()}`,
    '',
  ].join('\n');
}

function printCursorAccounts(json: boolean): void {
  const accounts = listCursorAccounts();
  if (json) {
    process.stdout.write(`${JSON.stringify({ accounts }, null, 2)}\n`);
    return;
  }

  if (accounts.length === 0) {
    process.stdout.write('No saved Cursor accounts.\n');
    return;
  }

  process.stdout.write('Cursor accounts:\n');
  for (const account of accounts) {
    const marker = account.isActive ? '*' : '-';
    const label = account.label ? `${account.label} (${account.id})` : account.id;
    process.stdout.write(`  ${marker} ${label}\n`);
  }
}

async function runCursorLogin(name?: string): Promise<void> {
  if (name && listCursorAccounts().some((account) => account.label?.toLowerCase() === name.toLowerCase())) {
    throw new TokenleakError(`Cursor account label already exists: ${name}`);
  }

  process.stdout.write(
    `Session tokens are stored in plaintext at ${getCursorCredentialsPath()} with local-only file permissions.\n`,
  );
  const token = await readSecret('Enter Cursor session token: ');
  if (!token) {
    throw new TokenleakError('No token provided');
  }

  process.stdout.write('Validating session token...\n');
  const result = await validateCursorSession(token);
  if (!result.valid) {
    throw new TokenleakError(result.error ?? 'Invalid session token');
  }

  const accountId = saveCursorCredentials(token, name);
  const display = name ?? accountId;
  process.stdout.write(`Saved Cursor account ${display}.\n`);
}

async function runCursorStatus(name?: string): Promise<void> {
  const credentials = name ? getCursorCredentialsFor(name) : getActiveCursorCredentials();
  if (!credentials) {
    throw new TokenleakError(name ? `Account not found: ${name}` : 'No saved Cursor accounts');
  }

  const result = await validateCursorSession(credentials.sessionToken);
  if (!result.valid) {
    throw new TokenleakError(result.error ?? 'Invalid / expired session');
  }

  process.stdout.write('Cursor session is valid.\n');
  if (result.membershipType) {
    process.stdout.write(`Membership: ${result.membershipType}\n`);
  }
}

function runCursorLogout(name: string | undefined, all: boolean, purgeCache: boolean): void {
  if (all) {
    removeAllCursorAccounts(purgeCache);
    process.stdout.write('Logged out from all Cursor accounts.\n');
    return;
  }

  if (name) {
    removeCursorAccount(name, purgeCache);
    process.stdout.write(`Logged out from Cursor account '${name}'.\n`);
    return;
  }

  const store = loadCursorCredentialsStore();
  if (!store) {
    throw new TokenleakError('No saved Cursor accounts');
  }

  removeCursorAccount(store.activeAccountId, purgeCache);
  process.stdout.write(`Logged out from Cursor account '${store.activeAccountId}'.\n`);
}

function parseNameFlag(argv: string[], index: number): [string, number] {
  const value = argv[index + 1];
  if (!value) {
    throw new TokenleakError(`${argv[index]} requires a value`);
  }
  return [value, index + 2];
}

function wrapCursorError(error: unknown): never {
  if (error instanceof TokenleakError) {
    throw error;
  }
  if (error instanceof CursorAuthError) {
    throw new TokenleakError(error.message);
  }
  throw error;
}

export async function runCursorCommand(argv: string[]): Promise<void> {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(buildCursorHelpText());
    return;
  }

  if (command === 'login') {
    let name: string | undefined;
    for (let index = 1; index < argv.length; ) {
      const arg = argv[index]!;
      if (arg === '--name') {
        [name, index] = parseNameFlag(argv, index);
      } else {
        throw new TokenleakError(`Unknown cursor flag "${arg}"`);
      }
    }

    try {
      await runCursorLogin(name);
    } catch (error: unknown) {
      wrapCursorError(error);
    }
    return;
  }

  if (command === 'status') {
    let name: string | undefined;
    for (let index = 1; index < argv.length; ) {
      const arg = argv[index]!;
      if (arg === '--name') {
        [name, index] = parseNameFlag(argv, index);
      } else {
        throw new TokenleakError(`Unknown cursor flag "${arg}"`);
      }
    }

    try {
      await runCursorStatus(name);
    } catch (error: unknown) {
      wrapCursorError(error);
    }
    return;
  }

  if (command === 'accounts') {
    if (argv.length > 2 || (argv[1] && argv[1] !== '--json')) {
      throw new TokenleakError(`Unknown cursor flag "${argv[1]}"`);
    }
    printCursorAccounts(argv.includes('--json'));
    return;
  }

  if (command === 'switch') {
    const target = argv[1];
    if (!target) {
      throw new TokenleakError('tokenleak cursor switch requires a name or account id');
    }
    try {
      setActiveCursorAccount(target);
    } catch (error: unknown) {
      wrapCursorError(error);
    }
    process.stdout.write(`Active Cursor account set to ${target}.\n`);
    return;
  }

  if (command === 'logout') {
    let name: string | undefined;
    let all = false;
    let purgeCache = false;
    for (let index = 1; index < argv.length; ) {
      const arg = argv[index]!;
      if (arg === '--name') {
        [name, index] = parseNameFlag(argv, index);
        continue;
      }
      if (arg === '--all') {
        all = true;
        index += 1;
        continue;
      }
      if (arg === '--purge-cache') {
        purgeCache = true;
        index += 1;
        continue;
      }
      throw new TokenleakError(`Unknown cursor flag "${arg}"`);
    }

    if (all && name) {
      throw new TokenleakError('tokenleak cursor logout cannot combine --all with --name');
    }

    try {
      runCursorLogout(name, all, purgeCache);
    } catch (error: unknown) {
      wrapCursorError(error);
    }
    return;
  }

  if (command === 'reset') {
    if (argv.length > 1) {
      throw new TokenleakError(`Unknown cursor flag "${argv[1]}"`);
    }
    try {
      resetCursorProviderState();
    } catch (error: unknown) {
      wrapCursorError(error);
    }
    process.stdout.write('Cleared saved Cursor accounts and local usage cache.\n');
    return;
  }

  throw new TokenleakError(`Unknown cursor command "${command}"`);
}
