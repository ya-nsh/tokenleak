import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { isInRange } from '../utils';
import {
  buildProviderData,
  collectFiles,
  extractDate,
  nonNegativeNumber,
  objectValue,
  sessionIdFromFile,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const ROO_DEFAULT_BASE_DIR = join(
  homedir(),
  '.config',
  'Code',
  'User',
  'globalStorage',
  'rooveterinaryinc.roo-cline',
  'tasks',
);
const KILO_DEFAULT_BASE_DIR = join(
  homedir(),
  '.config',
  'Code',
  'User',
  'globalStorage',
  'kilocode.kilo-code',
  'tasks',
);

const PROVIDERS = {
  roo: {
    provider: 'roo-code',
    displayName: 'Roo Code',
    env: 'TOKENLEAK_ROO_CODE_DIR',
    defaultBaseDir: ROO_DEFAULT_BASE_DIR,
    colors: {
      primary: '#0f766e',
      secondary: '#2dd4bf',
      gradient: ['#0f766e', '#2dd4bf'],
    } satisfies ProviderColors,
  },
  kilo: {
    provider: 'kilo-code',
    displayName: 'Kilo Code',
    env: 'TOKENLEAK_KILO_CODE_DIR',
    defaultBaseDir: KILO_DEFAULT_BASE_DIR,
    colors: {
      primary: '#2563eb',
      secondary: '#60a5fa',
      gradient: ['#2563eb', '#60a5fa'],
    } satisfies ProviderColors,
  },
} as const;

type RooKiloKind = keyof typeof PROVIDERS;

function isUiMessagesFile(_path: string, name: string): boolean {
  return name === 'ui_messages.json';
}

function extractTagValue(text: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let value: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]?.trim()) {
      value = match[1].trim();
    }
  }
  return value;
}

function readTaskMetadata(uiMessagesPath: string): { model: string; agent?: string } {
  const historyPath = join(dirname(uiMessagesPath), 'api_conversation_history.json');
  try {
    const content = readFileSync(historyPath, 'utf-8');
    return {
      model: extractTagValue(content, 'model') ?? 'unknown',
      agent: extractTagValue(content, 'slug') ?? extractTagValue(content, 'name') ?? undefined,
    };
  } catch {
    return { model: 'unknown' };
  }
}

function parseApiReqPayload(text: string): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  explicitCost: number;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const value = objectValue(parsed);
  if (!value) return null;

  return {
    inputTokens: nonNegativeNumber(value['tokensIn']),
    outputTokens: nonNegativeNumber(value['tokensOut']),
    cacheReadTokens: nonNegativeNumber(value['cacheReads']),
    cacheWriteTokens: nonNegativeNumber(value['cacheWrites']),
    explicitCost: nonNegativeNumber(value['cost']),
  };
}

function parseRooKiloFile(
  file: string,
  range: DateRange,
  metadata: LocalProviderMetadata,
): LocalUsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const taskDir = dirname(file);
  const sessionId = sessionIdFromFile(taskDir) || taskDir;
  const taskMetadata = readTaskMetadata(file);
  const records: LocalUsageRecord[] = [];

  for (const entryValue of parsed) {
    const entry = objectValue(entryValue);
    if (!entry || entry['type'] !== 'say' || entry['say'] !== 'api_req_started') {
      continue;
    }
    const text = stringValue(entry['text']);
    if (!text) {
      continue;
    }
    const payload = parseApiReqPayload(text);
    if (!payload) {
      continue;
    }
    const timestamp = timestampToIso(entry['ts']);
    const date = timestamp ? extractDate(timestamp) : null;
    if (!timestamp || !date || !isInRange(date, range)) {
      continue;
    }
    if (
      payload.inputTokens +
      payload.outputTokens +
      payload.cacheReadTokens +
      payload.cacheWriteTokens ===
      0
    ) {
      continue;
    }

    records.push({
      date,
      timestamp,
      model: taskMetadata.model,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
      cacheReadTokens: payload.cacheReadTokens,
      cacheWriteTokens: payload.cacheWriteTokens,
      explicitCost: payload.explicitCost,
      sessionId,
      projectId: taskMetadata.agent ?? metadata.provider,
    });
  }

  return records;
}

class RooKiloCodeProvider implements IProvider {
  readonly name: string;
  readonly displayName: string;
  readonly colors: ProviderColors;

  private readonly baseDir: string;
  private readonly metadata: LocalProviderMetadata;

  constructor(kind: RooKiloKind, baseDir?: string) {
    const config = PROVIDERS[kind];
    this.name = config.provider;
    this.displayName = config.displayName;
    this.colors = config.colors;
    this.baseDir = baseDir ?? process.env[config.env] ?? config.defaultBaseDir;
    this.metadata = {
      provider: config.provider,
      displayName: config.displayName,
      colors: config.colors,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.baseDir) && collectFiles(this.baseDir, isUiMessagesFile).length > 0;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records = collectFiles(this.baseDir, isUiMessagesFile)
      .flatMap((file) => parseRooKiloFile(file, range, this.metadata));
    return buildProviderData(this.metadata, records);
  }
}

export class RooCodeProvider extends RooKiloCodeProvider {
  constructor(baseDir?: string) {
    super('roo', baseDir);
  }
}

export class KiloCodeProvider extends RooKiloCodeProvider {
  constructor(baseDir?: string) {
    super('kilo', baseDir);
  }
}
