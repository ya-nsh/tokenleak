import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Shape of CLI config, mirroring flag names. */
export interface CliConfig {
  format: 'json' | 'svg' | 'png' | 'terminal';
  theme: 'dark' | 'light';
  since: string;
  until: string;
  days: number;
  output: string;
  width: number;
  noColor: boolean;
  noInsights: boolean;
  compare: string;
  provider: string;
  more: boolean;
}

const CONFIG_FILENAME = '.tokenleakrc';

/**
 * Reads ~/.tokenleakrc if it exists and returns parsed config.
 * Returns an empty object if the file does not exist or is invalid.
 */
export function loadConfig(): Partial<CliConfig> {
  try {
    const configPath = join(homedir(), CONFIG_FILENAME);
    const raw = readFileSync(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Partial<CliConfig>;
    }
    return {};
  } catch {
    return {};
  }
}
