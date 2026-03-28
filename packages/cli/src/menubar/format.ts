export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function toRemainingPercent(value: number | null): number | null {
  return typeof value === 'number' ? clampPercent(100 - value) : null;
}

export function formatPercentLeft(value: number | null): string {
  const remaining = toRemainingPercent(value);
  return typeof remaining === 'number' ? `${Math.round(remaining)}%` : '--';
}
