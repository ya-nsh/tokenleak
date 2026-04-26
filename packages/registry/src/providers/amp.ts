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

const PROVIDER_NAME = 'amp';
const DISPLAY_NAME = 'Amp';
const DEFAULT_BASE_DIR = join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'amp', 'threads');
const COLORS: ProviderColors = {
  primary: '#ff5a1f',
  secondary: '#fbbf24',
  gradient: ['#ff5a1f', '#fbbf24'],
};
const METADATA: LocalProviderMetadata = {
  provider: PROVIDER_NAME,
  displayName: DISPLAY_NAME,
  colors: COLORS,
};

interface AmpRecordCandidate extends LocalUsageRecord {
  messageId?: number;
  ledgerToMessageId?: number;
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_AMP_DIR'] ?? DEFAULT_BASE_DIR;
}

function isAmpFile(_path: string, name: string): boolean {
  return name.startsWith('T-') && name.endsWith('.json');
}

function parseTokens(tokens: Record<string, unknown> | null): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  return {
    inputTokens: nonNegativeNumber(tokens?.['input']) || nonNegativeNumber(tokens?.['inputTokens']),
    outputTokens: nonNegativeNumber(tokens?.['output']) || nonNegativeNumber(tokens?.['outputTokens']),
    cacheReadTokens:
      nonNegativeNumber(tokens?.['cacheReadInputTokens']) ||
      nonNegativeNumber(tokens?.['cacheReadTokens']),
    cacheWriteTokens:
      nonNegativeNumber(tokens?.['cacheCreationInputTokens']) ||
      nonNegativeNumber(tokens?.['cacheWriteTokens']),
  };
}

function recordsMatch(a: AmpRecordCandidate, b: AmpRecordCandidate): boolean {
  return (
    a.model === b.model &&
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens
  );
}

function mergeLedgerAndMessageRecords(
  ledgerRecords: AmpRecordCandidate[],
  messageRecords: AmpRecordCandidate[],
): LocalUsageRecord[] {
  const consumed = new Set<number>();
  const merged: AmpRecordCandidate[] = [];

  for (const messageRecord of messageRecords) {
    let matchIndex = -1;
    if (messageRecord.messageId !== undefined) {
      matchIndex = ledgerRecords.findIndex((record, index) =>
        !consumed.has(index) && record.ledgerToMessageId === messageRecord.messageId,
      );
    }
    if (matchIndex < 0) {
      matchIndex = ledgerRecords.findIndex((record, index) =>
        !consumed.has(index) && recordsMatch(record, messageRecord),
      );
    }

    if (matchIndex >= 0) {
      consumed.add(matchIndex);
      const ledgerRecord = ledgerRecords[matchIndex]!;
      merged.push({
        ...messageRecord,
        timestamp: ledgerRecord.timestamp,
        date: ledgerRecord.date,
        explicitCost: ledgerRecord.explicitCost ?? messageRecord.explicitCost,
      });
    } else {
      merged.push(messageRecord);
    }
  }

  ledgerRecords.forEach((record, index) => {
    if (!consumed.has(index)) {
      merged.push(record);
    }
  });

  return merged.map(({ messageId: _messageId, ledgerToMessageId: _ledgerToMessageId, ...record }) => record);
}

function parseAmpFile(file: string, range: DateRange): LocalUsageRecord[] {
  let thread: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    const value = objectValue(parsed);
    if (!value) return [];
    thread = value;
  } catch {
    return [];
  }

  const sessionId = stringValue(thread['id']) ?? stringValue(thread['threadId']) ?? file;
  const created = timestampToIso(thread['created']) ?? timestampToIso(thread['createdAt']) ?? fileModifiedTimestamp(file);
  const threadCreatedMs = Date.parse(created);
  const ledgerRecords: AmpRecordCandidate[] = [];
  const messageRecords: AmpRecordCandidate[] = [];

  const ledger = objectValue(thread['usageLedger']);
  const events = Array.isArray(ledger?.['events']) ? ledger['events'] as unknown[] : [];
  for (const eventValue of events) {
    const event = objectValue(eventValue);
    if (!event) continue;
    const model = stringValue(event['model']);
    if (!model) continue;

    const tokens = parseTokens(objectValue(event['tokens']));
    const timestamp = timestampToIso(event['timestamp']) ?? created;
    const date = extractDate(timestamp);
    if (!date || !isInRange(date, range)) continue;
    if (tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens === 0) continue;

    ledgerRecords.push({
      date,
      timestamp,
      model,
      ...tokens,
      explicitCost: safeNumber(event['credits']) ?? undefined,
      sessionId,
      ledgerToMessageId: safeNumber(event['toMessageId']) ?? undefined,
    });
  }

  const messages = Array.isArray(thread['messages']) ? thread['messages'] as unknown[] : [];
  for (const messageValue of messages) {
    const message = objectValue(messageValue);
    if (!message || message['role'] !== 'assistant') continue;
    const usage = objectValue(message['usage']);
    if (!usage) continue;

    const model = stringValue(usage['model']);
    if (!model) continue;
    const messageId = safeNumber(message['messageId']) ?? 0;
    const timestamp = new Date(
      Number.isFinite(threadCreatedMs) ? threadCreatedMs + (messageId * 1000) : Date.parse(created),
    ).toISOString();
    const date = extractDate(timestamp);
    if (!date || !isInRange(date, range)) continue;

    const tokens = parseTokens(usage);
    if (tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens === 0) continue;

    messageRecords.push({
      date,
      timestamp,
      model,
      ...tokens,
      explicitCost: safeNumber(usage['credits']) ?? undefined,
      sessionId,
      messageId,
    });
  }

  return mergeLedgerAndMessageRecords(ledgerRecords, messageRecords);
}

export class AmpProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.baseDir) && collectFiles(this.baseDir, isAmpFile).length > 0;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records = collectFiles(this.baseDir, isAmpFile).flatMap((file) => parseAmpFile(file, range));
    return buildProviderData(METADATA, records);
  }
}
