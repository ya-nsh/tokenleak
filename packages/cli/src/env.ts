import type { CliConfig } from './config';

const VALID_FORMATS = new Set(['json', 'svg', 'png', 'terminal']);
const VALID_THEMES = new Set(['dark', 'light']);

/**
 * Reads TOKENLEAK_* environment variables and returns matching config overrides.
 */
export function loadEnvOverrides(): Partial<CliConfig> {
  const overrides: Partial<CliConfig> = {};

  const format = process.env['TOKENLEAK_FORMAT'];
  if (format && VALID_FORMATS.has(format)) {
    overrides.format = format as CliConfig['format'];
  }

  const theme = process.env['TOKENLEAK_THEME'];
  if (theme && VALID_THEMES.has(theme)) {
    overrides.theme = theme as CliConfig['theme'];
  }

  const days = process.env['TOKENLEAK_DAYS'];
  if (days !== undefined && days !== '') {
    const parsed = Number(days);
    if (Number.isFinite(parsed) && parsed > 0) {
      overrides.days = parsed;
    }
  }

  return overrides;
}
