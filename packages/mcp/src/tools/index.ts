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

export function registerTools(server: McpServer, registry: ProviderRegistry): void {
  server.tool(
    'list_providers',
    'List all registered data providers and their availability status',
    {},
    async () => handleListProviders({}, registry),
  );

  server.tool(
    'get_usage_summary',
    'Get a summary of token usage and costs across all providers. Returns totals, streaks, rolling windows, cache hit rate, and per-provider breakdown.',
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
    'Get day-by-day token usage and cost data for trend analysis.',
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
    'Get a breakdown of costs by model, ranked from most to least expensive.',
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
    'Compare token usage between two time periods. Shows deltas for tokens, cost, streaks, active days, and cache hit rate.',
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
}
