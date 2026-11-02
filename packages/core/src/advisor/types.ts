export interface AdvisorRecommendation {
  type: 'model-downgrade' | 'cache-optimization' | 'usage-pattern';
  title: string;
  description: string;
  currentCost: number;
  projectedCost: number;
  monthlySavings: number;
  confidence: 'high' | 'medium' | 'low';
  details: Record<string, unknown>;
}

export interface AdvisorReport {
  recommendations: AdvisorRecommendation[];
  totalCurrentMonthlyCost: number;
  totalProjectedMonthlyCost: number;
  totalMonthlySavings: number;
  analyzedDays: number;
  analyzedEvents: number;
  /** Share of analyzed tokens that had a known price, 0..1 (1 when there are no tokens). */
  pricedTokenShare: number;
  /** Models whose tokens could not be priced, most tokens first. */
  unpricedModels: string[];
}

/**
 * Minimal pricing shape accepted by the advisor engine.
 * Matches the ModelPricing interface from @tokenleak/registry
 * without importing it (avoids circular dependency).
 */
export interface AdvisorModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
