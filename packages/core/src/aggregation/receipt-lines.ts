import type { DateRange, UsageEvent } from '../types';
import { clusterPrompts } from './prompt-clusters';

const DEFAULT_TOP_LINES = 12;
const DESCRIPTION_MAX_CHARS = 80;

export type ReceiptCategory =
  | 'debugging'
  | 'styling'
  | 'explain-again'
  | 'refactoring'
  | 'testing'
  | 'new-code'
  | 'opinion'
  | 'typo'
  | 'misc';

export interface ReceiptLine {
  description: string;
  category: ReceiptCategory;
  quantity: number;
  totalCost: number;
  totalTokens: number;
}

export interface ReceiptSummary {
  dateRange: DateRange;
  /** Number of prompts that rolled up into the returned lines. */
  accountedPrompts: number;
  /** Number of usage events in the period with no captured prompt text. */
  unlabeledEvents: number;
  /** Cost covered by the returned lines. */
  subtotal: number;
  /** Cost from usage events with no captured prompt — shown as "service fees". */
  serviceFees: number;
  /** subtotal + serviceFees. */
  total: number;
}

export interface Receipt {
  lines: ReceiptLine[];
  summary: ReceiptSummary;
}

export interface BuildReceiptOptions {
  topLines?: number;
  similarityThreshold?: number;
}

/**
 * Converts usage events (plus their captured prompts) into an itemized receipt.
 * Prompts are clustered by similarity, each cluster becomes a line item, and
 * costs from events without a captured prompt roll up into a single
 * "service fees" total.
 */
export function buildReceipt(
  events: UsageEvent[],
  dateRange: DateRange,
  options: BuildReceiptOptions = {},
): Receipt {
  const topLines = options.topLines ?? DEFAULT_TOP_LINES;

  const withPrompts: UsageEvent[] = [];
  let unlabeledEvents = 0;
  let serviceFees = 0;
  for (const e of events) {
    if (typeof e.prompt === 'string' && e.prompt.trim().length > 0) {
      withPrompts.push(e);
    } else {
      unlabeledEvents += 1;
      serviceFees += e.cost;
    }
  }

  const clusters = clusterPrompts(withPrompts, {
    similarityThreshold: options.similarityThreshold,
  });

  const maxLines = Math.max(1, Math.floor(topLines));
  const hasOverflow = clusters.length > maxLines;
  const ranked = clusters.slice(0, hasOverflow ? maxLines - 1 : maxLines);
  const lines: ReceiptLine[] = ranked.map((c) => ({
    description: formatDescription(c.canonicalPrompt),
    category: classify(c.canonicalPrompt),
    quantity: c.count,
    totalCost: c.totalCost,
    totalTokens: c.totalTokens,
  }));

  const overflow = clusters.slice(ranked.length);
  if (overflow.length > 0) {
    lines.push({
      description: `Other prompt clusters (${overflow.length})`,
      category: 'misc',
      quantity: overflow.reduce((sum, c) => sum + c.count, 0),
      totalCost: overflow.reduce((sum, c) => sum + c.totalCost, 0),
      totalTokens: overflow.reduce((sum, c) => sum + c.totalTokens, 0),
    });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.totalCost, 0);
  const accountedPrompts = lines.reduce((sum, l) => sum + l.quantity, 0);

  return {
    lines,
    summary: {
      dateRange,
      accountedPrompts,
      unlabeledEvents,
      subtotal,
      serviceFees,
      total: subtotal + serviceFees,
    },
  };
}

function formatDescription(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (compact.length <= DESCRIPTION_MAX_CHARS) return compact;
  return `${compact.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`;
}

interface CategoryRule {
  category: ReceiptCategory;
  pattern: RegExp;
}

// Classification precedence: first matching rule wins. Rules are ordered from
// most specific to most generic so that a prompt like "write a test for the
// error handler" classifies as `testing` (intent) rather than `debugging`
// (which matches the incidental word `error`). The `debugging` pattern is
// deliberately last because its keywords (fix, bug, error, broken) show up
// across many unrelated prompts and should only fire when no more specific
// intent is present.
const CATEGORY_RULES: CategoryRule[] = [
  { category: 'typo', pattern: /\b(typo|missing (semicolon|comma|bracket)|one[- ]liner)\b/i },
  {
    category: 'styling',
    pattern: /\b(center|centre|padding|margin|flex|grid|css|tailwind|style|color|colou?r|font|align|div|layout)\b/i,
  },
  { category: 'testing', pattern: /\b(test|spec|assert|mock|stub|coverage|jest|vitest|bun test)\b/i },
  {
    category: 'explain-again',
    pattern: /\b(explain|what does|what is|how does|why is|walk me through|can you describe|tell me about)\b/i,
  },
  { category: 'refactoring', pattern: /\b(refactor|rename|extract|simplif(y|ies)|clean ?up|deduplic|inline)\b/i },
  {
    category: 'new-code',
    pattern: /\b(implement|add (a|an|the)?|create (a|an|the)?|build (a|an|the)?|write (a|an|the)?|generate|scaffold)\b/i,
  },
  {
    category: 'opinion',
    pattern: /\b(should i|which (is|would)|what do you think|recommend|better approach|best way|opinion)\b/i,
  },
  {
    category: 'debugging',
    pattern: /\b(debug|error|fail(ed|ing)?|broken|bug|stack ?trace|doesn'?t work|why (isn'?t|won'?t)|fix)\b/i,
  },
];

function classify(prompt: string): ReceiptCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(prompt)) return rule.category;
  }
  return 'misc';
}
