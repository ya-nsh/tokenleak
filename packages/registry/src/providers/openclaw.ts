import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { DateRange, ProviderColors, ProviderData } from '@tokenleak/core';
import type { IProvider } from '../provider';
import { splitJsonlRecords } from '../parsers/jsonl-splitter';
import { isInRange } from '../utils';
import {
  buildProviderData,
  collectFiles,
  extractDate,
  fileModifiedTimestamp,
  nonNegativeNumber,
  objectValue,
  safeNumber,
  sessionIdFromFile,
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'openclaw';
const DISPLAY_NAME = 'OpenClaw';
const DEFAULT_BASE_DIR = join(homedir(), '.openclaw', 'agents');
const COLORS: ProviderColors = {
  primary: '#dc2626',
  secondary: '#fb7185',
  gradient: ['#dc2626', '#fb7185'],
};
const METADATA: LocalProviderMetadata = {
  provider: PROVIDER_NAME,
  displayName: DISPLAY_NAME,
  colors: COLORS,
};

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_OPENCLAW_DIR'] ?? DEFAULT_BASE_DIR;
}

function isOpenClawFile(_path: string, name: string): boolean {
  return name.endsWith('.jsonl') || name.includes('.jsonl.');
}

function extractModelSnapshotModel(entry: Record<string, unknown>): string | null {
  if (entry['custom_type'] !== 'model-snapshot' && entry['customType'] !== 'model-snapshot') {
    return null;
  }

  const data = objectValue(entry['data']);
  return stringValue(data?.['modelId']) ?? stringValue(data?.['model_id']);
}

async function parseOpenClawSession(
  file: string,
  sessionId: string,
  range: DateRange,
): Promise<LocalUsageRecord[]> {
  const fallbackTimestamp = fileModifiedTimestamp(file);
  const records: LocalUsageRecord[] = [];
  let currentModel: string | null = null;

  try {
    for await (const record of splitJsonlRecords(file)) {
      const entry = objectValue(record);
      if (!entry) continue;

      if (entry['type'] === 'model_change') {
        currentModel =
          stringValue(entry['modelId']) ??
          stringValue(entry['model_id']) ??
          currentModel;
        continue;
      }

      if (entry['type'] === 'custom') {
        currentModel = extractModelSnapshotModel(entry) ?? currentModel;
        continue;
      }

      if (entry['type'] !== 'message') {
        continue;
      }

      const message = objectValue(entry['message']);
      if (!message || message['role'] !== 'assistant') {
        continue;
      }
      const usage = objectValue(message['usage']);
      if (!usage) {
        continue;
      }

      const model =
        stringValue(message['model']) ??
        stringValue(entry['modelId']) ??
        stringValue(entry['model_id']) ??
        currentModel;
      if (!model) {
        continue;
      }
      currentModel = model;

      const timestamp = timestampToIso(message['timestamp']) ?? timestampToIso(entry['timestamp']) ?? fallbackTimestamp;
      const date = extractDate(timestamp);
      if (!date || !isInRange(date, range)) {
        continue;
      }

      const costObject = objectValue(usage['cost']);
      const inputTokens = nonNegativeNumber(usage['input']);
      const outputTokens = nonNegativeNumber(usage['output']);
      const cacheReadTokens = nonNegativeNumber(usage['cacheRead']) || nonNegativeNumber(usage['cache_read']);
      const cacheWriteTokens = nonNegativeNumber(usage['cacheWrite']) || nonNegativeNumber(usage['cache_write']);
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) {
        continue;
      }

      records.push({
        date,
        timestamp,
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        explicitCost: safeNumber(costObject?.['total']) ?? undefined,
        sessionId,
      });
    }
  } catch {
    return records;
  }

  return records;
}

function parseOpenClawIndex(indexPath: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return [];
  }

  const root = objectValue(parsed);
  const sessions = objectValue(root?.['sessions']);
  if (!sessions) {
    return [];
  }

  const indexDir = dirname(indexPath);
  const paths: string[] = [];
  for (const value of Object.values(sessions)) {
    const entry = objectValue(value);
    if (!entry) continue;
    const sessionId = stringValue(entry['sessionId']) ?? stringValue(entry['session_id']);
    const sessionFile = stringValue(entry['sessionFile']) ?? stringValue(entry['session_file']);
    if (sessionFile) {
      paths.push(isAbsolute(sessionFile) ? sessionFile : resolve(indexDir, sessionFile));
    } else if (sessionId) {
      paths.push(join(indexDir, `${sessionId}.jsonl`));
    }
  }

  return paths;
}

export class OpenClawProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.baseDir) && (
        collectFiles(this.baseDir, isOpenClawFile).length > 0 ||
        existsSync(join(this.baseDir, 'sessions.json'))
      );
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const files = new Set(collectFiles(this.baseDir, isOpenClawFile));
    const indexPath = join(this.baseDir, 'sessions.json');
    if (existsSync(indexPath)) {
      for (const file of parseOpenClawIndex(indexPath)) {
        if (existsSync(file)) files.add(file);
      }
    }

    const records: LocalUsageRecord[] = [];
    for (const file of [...files].sort()) {
      records.push(...await parseOpenClawSession(file, sessionIdFromFile(file), range));
    }

    return buildProviderData(METADATA, records);
  }
}
