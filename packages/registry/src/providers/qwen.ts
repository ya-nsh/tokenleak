import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
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
  stringValue,
  timestampToIso,
  type LocalProviderMetadata,
  type LocalUsageRecord,
} from './local-usage';

const PROVIDER_NAME = 'qwen';
const DISPLAY_NAME = 'Qwen';
const DEFAULT_BASE_DIR = join(homedir(), '.qwen', 'projects');
const DEFAULT_MODEL = 'qwen';
const COLORS: ProviderColors = {
  primary: '#7c3aed',
  secondary: '#c084fc',
  gradient: ['#7c3aed', '#c084fc'],
};
const METADATA: LocalProviderMetadata = {
  provider: PROVIDER_NAME,
  displayName: DISPLAY_NAME,
  colors: COLORS,
};

function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? process.env['TOKENLEAK_QWEN_DIR'] ?? DEFAULT_BASE_DIR;
}

function isQwenFile(_path: string, name: string): boolean {
  return name.endsWith('.jsonl');
}

function fallbackSessionId(file: string, baseDir: string): string {
  const rel = relative(baseDir, file).split(sep);
  const fileName = basename(file, '.jsonl');
  const projectsIndex = rel.lastIndexOf('projects');
  if (projectsIndex >= 0 && rel[projectsIndex + 1]) {
    return `${rel[projectsIndex + 1]}:${fileName}`;
  }
  return rel.join('/') || fileName;
}

async function parseQwenFile(file: string, baseDir: string, range: DateRange): Promise<LocalUsageRecord[]> {
  const records: LocalUsageRecord[] = [];
  const fallbackTimestamp = fileModifiedTimestamp(file);
  const pathSessionId = fallbackSessionId(file, baseDir);
  const relParts = relative(baseDir, file).split(sep);
  const projectId = relParts.length > 2 ? relParts[0] : undefined;

  try {
    for await (const record of splitJsonlRecords(file)) {
      const value = objectValue(record);
      if (!value || value['type'] !== 'assistant') {
        continue;
      }

      const usage = objectValue(value['usageMetadata']);
      if (!usage) {
        continue;
      }

      const timestamp = timestampToIso(value['timestamp']) ?? fallbackTimestamp;
      const date = extractDate(timestamp);
      if (!date || !isInRange(date, range)) {
        continue;
      }

      const input = nonNegativeNumber(usage['promptTokenCount']);
      const output =
        nonNegativeNumber(usage['candidatesTokenCount']) +
        nonNegativeNumber(usage['thoughtsTokenCount']);
      const cacheRead = nonNegativeNumber(usage['cachedContentTokenCount']);
      if (input + output + cacheRead === 0) {
        continue;
      }

      records.push({
        date,
        timestamp,
        model: stringValue(value['model']) ?? DEFAULT_MODEL,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
        sessionId: stringValue(value['sessionId']) ?? pathSessionId,
        projectId,
      });
    }
  } catch {
    return records;
  }

  return records;
}

export class QwenProvider implements IProvider {
  readonly name = PROVIDER_NAME;
  readonly displayName = DISPLAY_NAME;
  readonly colors = COLORS;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir);
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.baseDir) && collectFiles(this.baseDir, isQwenFile).length > 0;
    } catch {
      return false;
    }
  }

  async load(range: DateRange): Promise<ProviderData> {
    const records: LocalUsageRecord[] = [];
    for (const file of collectFiles(this.baseDir, isQwenFile)) {
      records.push(...await parseQwenFile(file, this.baseDir, range));
    }
    return buildProviderData(METADATA, records);
  }
}
