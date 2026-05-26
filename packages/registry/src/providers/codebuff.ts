import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { isInRange } from '../utils';
import {
  buildProviderData,
  collectFiles,
  extractDate,
  fileModifiedTimestamp,
  nonNegativeNumber,
  objectValue,
  safeNumber,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'codebuff';
const DISPLAY_NAME = 'Codebuff';
const DEFAULT_BASE_DIR = join(homedir(), '.config', 'manicode');
const COLORS: ProviderColors = {
  primary: '#2563eb',
  secondary: '#38bdf8',
  gradient: ['#2563eb', '#38bdf8'],
};
const METADATA: LocalProviderMetadata = { provider: PROVIDER_NAME, displayName: DISPLAY_NAME, colors: COLORS };

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_CODEBUFF_DIR'] ?? DEFAULT_BASE_DIR;
}

function isCodebuffFile(_path: string, name: string): boolean {
  return name === 'chat-messages.json';
}

function chatIdToIso(chatId: string): string | null {
  const t = chatId.indexOf('T');
  if (t < 0) return null;
  const rebuilt = `${chatId.slice(0, t)}${chatId.slice(t).replace('-', ':').replace('-', ':')}`;
  return timestampToIso(rebuilt);
}

function contextFromPath(file: string): { projectId: string; sessionId: string; chatId: string } {
  const parts = file.split(/[\\/]/);
  const chatId = parts.at(-2) ?? 'unknown';
  const chatsIndex = parts.lastIndexOf('chats');
  const projectId = chatsIndex > 0 ? parts[chatsIndex - 1]! : 'unknown';
  return { projectId, chatId, sessionId: `${projectId}/${chatId}` };
}

function usageFromMessage(message: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = objectValue(message['metadata']);
  const direct = objectValue(metadata?.['usage']) ?? objectValue(objectValue(metadata?.['codebuff'])?.['usage']);
  if (direct) return direct;

  const history = objectValue(objectValue(objectValue(metadata?.['runState'])?.['sessionState'])?.['mainAgentState'])?.['messageHistory'];
  if (Array.isArray(history)) {
    for (const entryValue of [...history].reverse()) {
      const entry = objectValue(entryValue);
      const providerOptions = objectValue(entry?.['providerOptions']);
      const usage = objectValue(providerOptions?.['usage']) ?? objectValue(providerOptions?.['tokenUsage']);
      if (usage) return usage;
    }
  }

  return null;
}

function parseCodebuffFile(file: string, range: DateRange): LocalUsageRecord[] {
  let messages: unknown[];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    messages = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }

  const context = contextFromPath(file);
  const fallbackTimestamp = chatIdToIso(context.chatId) ?? fileModifiedTimestamp(file);
  const records: LocalUsageRecord[] = [];

  for (const messageValue of messages) {
    const message = objectValue(messageValue);
    if (!message) continue;
    const role = stringValue(message['variant']) ?? stringValue(message['role']);
    if (role !== 'assistant' && role !== 'agent' && role !== 'ai') continue;
    const usage = usageFromMessage(message);
    if (!usage) continue;

    const timestamp = timestampToIso(message['timestamp']) ?? timestampToIso(message['createdAt']) ?? fallbackTimestamp;
    const date = extractDate(timestamp);
    if (!date || !isInRange(date, range)) continue;

    const inputTokens = nonNegativeNumber(usage['inputTokens']) || nonNegativeNumber(usage['input']);
    const outputTokens = nonNegativeNumber(usage['outputTokens']) || nonNegativeNumber(usage['output']);
    const cacheReadTokens =
      nonNegativeNumber(usage['cacheReadInputTokens']) || nonNegativeNumber(usage['cacheReadTokens']);
    const cacheWriteTokens =
      nonNegativeNumber(usage['cacheCreationInputTokens']) || nonNegativeNumber(usage['cacheWriteTokens']);
    if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) continue;

    records.push({
      date,
      timestamp,
      model: stringValue(usage['model']) ?? stringValue(usage['modelName']) ?? 'codebuff-unknown',
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      explicitCost: safeNumber(usage['credits']) ?? safeNumber(usage['cost']) ?? undefined,
      sessionId: context.sessionId,
      projectId: context.projectId,
    });
  }

  return records;
}

export class CodebuffProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.baseDir) && collectFiles(this.baseDir, isCodebuffFile).length > 0;
  }

  async load(range: DateRange): Promise<ProviderData> {
    return buildProviderData(METADATA, collectFiles(this.baseDir, isCodebuffFile).flatMap((file) => parseCodebuffFile(file, range)));
  }
}
