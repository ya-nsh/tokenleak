const COMPACT_UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];
const CENTS_THRESHOLD = 0.01;
const WHOLE_DOLLAR_THRESHOLD = 1_000;

/** Below this many units, one decimal adds information; above it, it is noise. */
const DECIMAL_LIMIT = 100;
const UNIT_ROLLOVER = 1000;

function scaled(abs: number, size: number): { value: number; text: string } {
  const raw = abs / size;
  const oneDecimal = Math.round(raw * 10) / 10;
  // 99.96 rounds to 100.0, which should read as a whole number like 100.4 does.
  if (oneDecimal < DECIMAL_LIMIT) return { value: oneDecimal, text: oneDecimal.toFixed(1) };
  const whole = Math.round(raw);
  return { value: whole, text: whole.toFixed(0) };
}

/**
 * Compact token count for display: `950`, `12.3K`, `404K`, `1.3M`, `117M`,
 * `15.9B`. Values that round up to 1000 of a unit roll over to the next one
 * (`1.0M`, never `1000K`).
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  for (let index = 0; index < COMPACT_UNITS.length; index++) {
    const [size, suffix] = COMPACT_UNITS[index]!;
    if (abs < size) continue;
    const result = scaled(abs, size);
    const larger = COMPACT_UNITS[index - 1];
    if (result.value >= UNIT_ROLLOVER && larger) {
      return `${sign}${scaled(abs, larger[0]).text}${larger[1]}`;
    }
    return `${sign}${result.text}${suffix}`;
  }
  const rounded = Math.round(abs);
  return rounded >= UNIT_ROLLOVER ? `${sign}1.0K` : `${sign}${rounded}`;
}

/** US dollars for display: `$0.00`, `<$0.01`, `$12.34`, `$1,234`. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < CENTS_THRESHOLD) return `${sign}<$0.01`;
  if (abs < WHOLE_DOLLAR_THRESHOLD) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}
