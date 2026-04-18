import type { UsageEvent } from '../types';

const DEFAULT_SIMILARITY_THRESHOLD = 0.6;
const MIN_TOKEN_LENGTH = 3;
const NGRAM_SIZE = 2;

export interface PromptCluster {
  /** The representative prompt text — the one that cost the most in the cluster. */
  canonicalPrompt: string;
  /** Number of prompts rolled into this cluster. */
  count: number;
  /** Summed cost across all prompts in the cluster. */
  totalCost: number;
  /** Summed tokens across all prompts in the cluster. */
  totalTokens: number;
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
    canonicalPrompt: string;
    canonicalCost: number;
    signature: Set<string>;
    count: number;
    totalCost: number;
    totalTokens: number;
  }

  const clusters: WorkingCluster[] = [];

  for (const event of withPrompts) {
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
      c.count += 1;
      c.totalCost += event.cost;
      c.totalTokens += event.totalTokens;
      if (event.cost > c.canonicalCost) {
        c.canonicalPrompt = prompt;
        c.canonicalCost = event.cost;
      }
      for (const bigram of signature) c.signature.add(bigram);
    } else {
      clusters.push({
        canonicalPrompt: prompt,
        canonicalCost: event.cost,
        signature,
        count: 1,
        totalCost: event.cost,
        totalTokens: event.totalTokens,
      });
    }
  }

  return clusters
    .map((c) => ({
      canonicalPrompt: c.canonicalPrompt,
      count: c.count,
      totalCost: c.totalCost,
      totalTokens: c.totalTokens,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);
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
