import type { CostCompleteness } from '@tokenleak/core';

/** Format a token count into a human-readable abbreviated string */
export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

/** Format a cost value with dollar sign and 2 decimal places */
export function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function isCostComplete(completeness: CostCompleteness | undefined): boolean {
  return !completeness || completeness.status === 'complete';
}

export function formatCostWithCompleteness(
  n: number,
  completeness: CostCompleteness | undefined,
): string {
  const formatted = formatCost(n);
  return isCostComplete(completeness) ? formatted : `${formatted}+`;
}

export function formatCostCompletenessWarning(
  completeness: CostCompleteness | undefined,
): string | null {
  if (isCostComplete(completeness) || !completeness) {
    return null;
  }

  const label = completeness.status === 'unknown' ? 'Cost unknown' : 'Cost incomplete';
  const modelList = completeness.unknownModels.slice(0, 3).join(', ');
  const extraModels = completeness.unknownModels.length > 3
    ? ` +${completeness.unknownModels.length - 3} more`
    : '';
  const modelSuffix = modelList ? ` (${modelList}${extraModels})` : '';

  return `${label}: ${formatTokens(completeness.unpricedTokens)} unpriced tokens${modelSuffix}`;
}

/** Format a percentage with 1 decimal place and % suffix */
export function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Right-pad a string to a given width */
export function padRight(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

/** Left-pad a string to a given width */
export function padLeft(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : ' '.repeat(width - s.length) + s;
}

/** Truncate a string to maxLen, adding ellipsis if needed */
export function truncate(s: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (maxLen === 1) return '\u2026';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '\u2026';
}

export function cleanInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function wrapText(value: string, width: number, maxLines: number): string[] {
  const safeWidth = Math.max(1, width);
  const safeMaxLines = Math.max(1, maxLines);
  const words = cleanInlineText(value).split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= safeWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    } else {
      lines.push(truncate(word, safeWidth));
      current = '';
      if (lines.length >= safeMaxLines) {
        break;
      }
      continue;
    }

    if (lines.length >= safeMaxLines) {
      break;
    }
    current = word.length > safeWidth ? truncate(word, safeWidth) : word;
  }

  if (current && lines.length < safeMaxLines) {
    lines.push(current);
  }

  const fullText = words.join(' ');
  if (lines.length === safeMaxLines && fullText.length > lines.join(' ').length) {
    lines[safeMaxLines - 1] = truncate(lines[safeMaxLines - 1] ?? '', safeWidth);
  }

  return lines.length > 0 ? lines : [''];
}

/** Build a simple ASCII bar chart segment */
export function asciiBar(ratio: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const w = Math.max(0, Math.floor(width));
  const filled = Math.round(clamped * w);
  const empty = w - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

/** Format a date string as "Mon DD" (e.g., "Mar 15") */
export function formatShortDate(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = dateStr.split('-');
  const monthIdx = parseInt(parts[1]!, 10) - 1;
  const day = parseInt(parts[2]!, 10);
  if (isNaN(monthIdx) || isNaN(day) || monthIdx < 0 || monthIdx > 11) return dateStr;
  return `${months[monthIdx]} ${day}`;
}
