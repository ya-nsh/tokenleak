import { writeFileSync } from 'node:fs';
import { SCHEMA_VERSION, VERSION, formatUsd } from '@tokenleak/core';

export function buildVersionText(): string {
  return `tokenleak ${VERSION}\nschema ${SCHEMA_VERSION}\n`;
}

export function truncateCell(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 3) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 3)}...`;
}

export function formatNullableNumber(value: number | null, digits: number = 0): string {
  if (value === null) {
    return '-';
  }

  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatNullableCost(value: number | null): string {
  return value === null ? '-' : formatUsd(value);
}

export async function writeReportOutput(rendered: string, output: string | null): Promise<void> {
  if (output) {
    writeFileSync(output, rendered);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}
