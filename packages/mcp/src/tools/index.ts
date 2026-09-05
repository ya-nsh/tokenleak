import { handleGetSubscriptionQuotas } from './get-subscription-quotas.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProviderRegistry } from '@tokenleak/registry';
import { z } from 'zod';
import { handleListProviders } from './list-providers.js';
import { handleGetUsageSummary } from './get-usage-summary.js';
import { handleGetDailyUsage } from './get-daily-usage.js';
import { handleGetCostBreakdown } from './get-cost-breakdown.js';
import { handleGetStreaksAndHabits } from './get-streaks-and-habits.js';
import { handleComparePeriods } from './compare-periods.js';
import { handleGetEfficiencyAdvice } from './get-efficiency-advice.js';
import { handleGetReceiptLines } from './get-receipt-lines.js';
import { handleGetRoutingSimulation } from './get-routing-simulation.js';
import { handleGetAgentWaste } from './get-agent-waste.js';
import { handleGetAgentBehaviorDiff } from './get-agent-behavior-diff.js';

const behaviorSelectorSchema = z.object({
  label: z.string(),
  dimension: z.enum(['provider', 'model', 'project', 'repo', 'date-range', 'session-style']),
  provider: z.string().optional(),
  model: z.string().optional(),
  projectId: z.string().optional(),
  repoRoot: z.string().optional(),
  dateRange: z.object({ since: z.string(), until: z.string() }).optional(),
  taskStyle: z.enum(['quick-hit', 'iterative', 'deep-work', 'mixed']).optional(),
});

export function registerTools(server: McpServer, registry: ProviderRegistry): void {
  server.tool(
    'get_subscription_quotas',
    'Read live account-wide subscription capacity and reset times from Claude, Codex, or GitHub Copilot using existing credentials. Makes provider network requests; no historical log scan or credential changes.',
    { provider: z.enum(['claude', 'codex', 'copilot']).optional(), refresh: z.boolean().optional() },
    async (args) => handleGetSubscriptionQuotas(args),
  );
  server.tool(
    'list_providers',
    'List all registered data providers and their availability status',
    {},
    async () => handleListProviders({}, registry),
  );

  server.tool(
    'get_usage_summary',
    'Get a summary of token usage and costs across all providers. Returns totals, cost completeness, provider-load warnings, streaks, rolling windows, cache hit rate, and per-provider breakdown.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
      provider: z.string().optional().describe('Filter to a specific provider by name'),
    },
    async (args) => handleGetUsageSummary(args, registry),
  );

  server.tool(
    'get_daily_usage',
    'Get day-by-day token usage and cost data for trend analysis, including per-day cost completeness.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 14)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
      provider: z.string().optional().describe('Filter to a specific provider by name'),
    },
    async (args) => handleGetDailyUsage(args, registry),
  );

  server.tool(
    'get_cost_breakdown',
    'Get a breakdown of costs by model, ranked from most to least expensive, including aggregate cost completeness.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
    },
    async (args) => handleGetCostBreakdown(args, registry),
  );

  server.tool(
    'get_streaks_and_habits',
    'Get usage streaks, day-of-week distribution, peak usage day, session metrics, and hour-of-day patterns.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 90)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
    },
    async (args) => handleGetStreaksAndHabits(args, registry),
  );

  server.tool(
    'compare_periods',
    'Compare token usage between two time periods. Shows deltas for tokens, cost, cost completeness, streaks, active days, and cache hit rate.',
    {
      current_since: z.string().describe('Start date of the current period (YYYY-MM-DD)'),
      current_until: z.string().optional().describe('End date of the current period (default: today)'),
      previous_since: z.string().optional().describe('Start date of the previous period (auto-computed if omitted)'),
      previous_until: z.string().optional().describe('End date of the previous period (auto-computed if omitted)'),
    },
    async (args) => handleComparePeriods(args, registry),
  );

  server.tool(
    'get_efficiency_advice',
    'Analyze token usage patterns and suggest cost-saving model switches and optimizations. Returns actionable recommendations with projected savings.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
      provider: z.string().optional().describe('Filter to a specific provider by name'),
    },
    async (args) => handleGetEfficiencyAdvice(args, registry),
  );

  server.tool(
    'get_receipt_lines',
    'Generate an itemized receipt of AI coding spend by prompt behavior. Clusters repeated prompts into line items with categories (debugging, styling, refactoring, etc.) and aggregates cost per cluster. Prompt capture currently uses Claude Code and Codex logs when prompt text is present.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
      provider: z.string().optional().describe('Filter to a specific provider by name'),
      topLines: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Maximum number of line items to return (default: 12, max: 100)'),
    },
    async (args) => handleGetReceiptLines(args, registry),
  );

  server.tool(
    'get_routing_simulation',
    'Simulate model-routing savings by re-pricing historical events under conservative or manual downgrade rules.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
      provider: z.string().optional().describe('Filter to a specific provider by name'),
      strategy: z.string().optional().describe('Routing strategy name, default conservative'),
    },
    async (args) => handleGetRoutingSimulation(args, registry),
  );

  server.tool(
    'get_agent_waste',
    'Detect agent waste signals such as context drag, repeated prompts, model churn, and cache waste.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
      provider: z.string().optional().describe('Filter to a specific provider by name'),
      severity: z.enum(['all', 'high', 'medium', 'low']).optional().describe('Optional severity filter'),
    },
    async (args) => handleGetAgentWaste(args, registry),
  );

  server.tool(
    'get_agent_behavior_diff',
    'Compare two cohorts by provider, model, project, repo, date range, or session style.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      until: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
      baseline: behaviorSelectorSchema.describe('Baseline cohort selector'),
      comparison: behaviorSelectorSchema.describe('Comparison cohort selector'),
    },
    async (args) => handleGetAgentBehaviorDiff(args, registry),
  );
}
