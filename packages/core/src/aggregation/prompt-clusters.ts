import { buildEventCostCompleteness } from '../cost-completeness';
import type { CostCompleteness, UsageEvent } from '../types';

const DEFAULT_SIMILARITY_THRESHOLD = 0.6;
const MIN_TOKEN_LENGTH = 3;
const NGRAM_SIZE = 2;
const SAMPLE_PROMPT_COUNT = 3;
const SAMPLE_PROMPT_MAX_CHARS = 120;

export interface PromptCluster {
  costCompleteness?: CostCompleteness;
  /** The representative prompt text — the one that cost the most in the cluster. */
  canonicalPrompt: string;
  /** Number of prompts rolled into this cluster. */
  count: number;
  /** Summed cost across all prompts in the cluster. */
  totalCost: number;
  /** Summed tokens across all prompts in the cluster. */
  totalTokens: number;
  /**
   * Up to {@link SAMPLE_PROMPT_COUNT} representative prompts in this cluster,
   * ranked by cost descending, deduped, and truncated to
   * {@link SAMPLE_PROMPT_MAX_CHARS} characters each. Useful for drill-down
   * views (TUI, MCP) that want to show "what went into this line item" without
   * carrying every event.
   */
  samplePrompts: string[];
}

export interface ClusterOptions {
  /** Jaccard similarity threshold (0-1) above which two prompts merge into the same cluster. */
  similarityThreshold?: number;
}

/**
 * Groups near-duplicate prompts using Jaccard similarity on token bigrams.
 * Returns clusters sorted by total cost, descending.
 *
 * Intended for the Receipts feature: repeated asks ("center a div", "fix lint")
 * roll up into single line items priced at their aggregate cost.
 */
export function clusterPrompts(
  events: UsageEvent[],
  options: ClusterOptions = {},
): PromptCluster[] {
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const withPrompts = events.filter((e) => typeof e.prompt === 'string' && e.prompt.trim().length > 0);
  if (withPrompts.length === 0) return [];

  interface WorkingCluster {
    promptKeys: Set<string>;
    events: UsageEvent[];
    canonicalPrompt: string;
    canonicalCost: number;
    signature: Set<string>;
    count: number;
    totalCost: number;
    totalTokens: number;
    /** Highest-cost members seen so far, kept as a length-capped min-heap-like list. */
    topMembers: Array<{ prompt: string; cost: number }>;
  }

  const clusters: WorkingCluster[] = [];

  for (const [index, event] of withPrompts.entries()) {
    const promptId = event.promptId?.trim() || event.turnId?.trim();
    const promptKey = promptId
      ? JSON.stringify([event.provider, event.sessionId, promptId])
      : JSON.stringify(['event', index]);
    const prompt = event.prompt!.trim();
    const signature = tokenBigrams(prompt);
    if (signature.size === 0) {
      // Prompts made only of short tokens (e.g. "go", "ok") produce no bigrams.
      // Fall back to a unique exact-match singleton so the billed event still
      // lands in clustering and never disappears from the receipt total.
      signature.add(`\u0000exact\u0001${normalize(prompt) || prompt.toLowerCase()}`);
    }

    let best: { cluster: WorkingCluster; sim: number } | null = null;
    for (const cluster of clusters) {
      const sim = jaccard(signature, cluster.signature);
      if (sim >= threshold && (best === null || sim > best.sim)) {
        best = { cluster, sim };
      }
    }

    if (best !== null) {
      const c = best.cluster;
      c.promptKeys.add(promptKey);
      c.count = c.promptKeys.size;
      c.events.push(event);
      c.totalCost += event.cost;
      c.totalTokens += event.totalTokens;
      if (event.cost > c.canonicalCost) {
        c.canonicalPrompt = prompt;
        c.canonicalCost = event.cost;
      }
      for (const bigram of signature) c.signature.add(bigram);
      insertTopMember(c.topMembers, prompt, event.cost);
    } else {
      clusters.push({
        promptKeys: new Set([promptKey]),
        events: [event],
        canonicalPrompt: prompt,
        canonicalCost: event.cost,
        signature,
        count: 1,
        totalCost: event.cost,
        totalTokens: event.totalTokens,
        topMembers: [{ prompt, cost: event.cost }],
      });
    }
  }

  return clusters
    .map((c) => ({
      costCompleteness: buildEventCostCompleteness(c.events),
      canonicalPrompt: c.canonicalPrompt,
      count: c.count,
      totalCost: c.totalCost,
      totalTokens: c.totalTokens,
      samplePrompts: buildSamplePrompts(c.topMembers),
    }))
    .sort((a, b) => b.totalCost - a.totalCost);
}

function insertTopMember(
  topMembers: Array<{ prompt: string; cost: number }>,
  prompt: string,
  cost: number,
): void {
  // Keep topMembers sorted by cost descending, deduped by the compacted prompt
  // key, and capped at SAMPLE_PROMPT_COUNT unique prompts. Dedup happens
  // before the cap so a burst of identical high-cost prompts cannot crowd out
  // unique lower-cost samples — e.g. ["fix lint"(10), "fix lint"(9),
  // "fix lint again"(8), "fix lint later"(7)] yields three distinct samples,
  // not two.
  //
  // At these sizes (max 3 entries) a linear scan is cheaper than a heap.
  const key = sampleKey(prompt);
  for (let i = 0; i < topMembers.length; i++) {
    if (sampleKey(topMembers[i]!.prompt) === key) {
      if (cost > topMembers[i]!.cost) {
        // Swap in the higher-cost duplicate and re-sort this one entry.
        topMembers.splice(i, 1);
        break;
      }
      return; // existing duplicate already dominates; drop the new one
    }
  }
  for (let i = 0; i < topMembers.length; i++) {
    if (cost > topMembers[i]!.cost) {
      topMembers.splice(i, 0, { prompt, cost });
      if (topMembers.length > SAMPLE_PROMPT_COUNT) topMembers.length = SAMPLE_PROMPT_COUNT;
      return;
    }
  }
  if (topMembers.length < SAMPLE_PROMPT_COUNT) {
    topMembers.push({ prompt, cost });
  }
}

function sampleKey(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildSamplePrompts(
  topMembers: Array<{ prompt: string; cost: number }>,
): string[] {
  const seen = new Set<string>();
  const samples: string[] = [];
  for (const member of topMembers) {
    const compact = member.prompt.replace(/\s+/g, ' ').trim();
    if (compact.length === 0) continue;
    const truncated =
      compact.length <= SAMPLE_PROMPT_MAX_CHARS
        ? compact
        : `${compact.slice(0, SAMPLE_PROMPT_MAX_CHARS - 1)}…`;
    if (seen.has(truncated)) continue;
    seen.add(truncated);
    samples.push(truncated);
    if (samples.length >= SAMPLE_PROMPT_COUNT) break;
  }
  return samples;
}

/**
 * Produces a similarity signature for a prompt: the union of its unigrams and
 * bigrams. Unigrams catch semantic overlap when wording differs; bigrams
 * reward shared phrasings. Lowercases, strips punctuation, drops very short
 * tokens (articles/prepositions). Exported for testing.
 */
export function tokenBigrams(text: string): Set<string> {
  const tokens = normalize(text)
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);

  if (tokens.length === 0) return new Set();

  const shingles = new Set<string>(tokens);
  for (let i = 0; i <= tokens.length - NGRAM_SIZE; i++) {
    shingles.add(`${tokens[i]}\u0001${tokens[i + 1]}`);
  }
  return shingles;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) {
    if (large.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
