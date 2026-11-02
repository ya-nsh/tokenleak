const COMPACT_UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];
const CENTS_THRESHOLD = 0.01;
const WHOLE_DOLLAR_THRESHOLD = 1_000;

/**
 * Compact token count for display: `950`, `12.3K`, `1.3M`, `15.9B`.
 * Rounds within a unit and promotes to the next one instead of printing
 * `1000.0K`.
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  for (let index = 0; index < COMPACT_UNITS.length; index++) {
    const [size, suffix] = COMPACT_UNITS[index]!;
    if (abs >= size) {
      const scaled = Math.round((abs / size) * 10) / 10;
      const larger = COMPACT_UNITS[index - 1];
      if (scaled >= 1000 && larger) {
        return `${sign}${(Math.round((abs / larger[0]) * 10) / 10).toFixed(1)}${larger[1]}`;
      }
      return `${sign}${scaled.toFixed(1)}${suffix}`;
    }
  }
  // Values just under 1K can round up to 1000; promote them for consistency.
  const rounded = Math.round(abs);
  return rounded >= 1000 ? `${sign}1.0K` : `${sign}${rounded}`;
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
