import { describe, it, expect } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ProviderColors, ProviderData, DateRange } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import { ProviderRegistry } from '@tokenleak/registry';
import { createTokenleakServer } from './server.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const TEST_COLORS: ProviderColors = {
  primary: '#6B5CE7',
  secondary: '#8B7AEF',
  gradient: ['#6B5CE7', '#8B7AEF'],
};

function makeProviderData(
  name: string,
  overrides: Partial<ProviderData> = {},
): ProviderData {
  return {
    provider: name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    daily: [
      {
        date: '2025-01-15',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        totalTokens: 1800,
        cost: 0.05,
        models: [
          {
            model: 'claude-sonnet-4-20250514',
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 200,
            cacheWriteTokens: 100,
            totalTokens: 1800,
            cost: 0.05,
          },
        ],
      },
    ],
    totalTokens: 1800,
    totalCost: 0.05,
    colors: TEST_COLORS,
    ...overrides,
  };
}

function createMockProvider(
  name: string,
  overrides: Partial<{
    available: boolean;
    data: ProviderData;
  }> = {},
): IProvider {
  const { available = true, data } = overrides;

  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    colors: TEST_COLORS,
    async isAvailable() {
      return available;
    },
    async load(_range: DateRange) {
      return data ?? makeProviderData(name);
    },
  };
}

function createTestRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(createMockProvider('test-provider-a'));
  registry.register(createMockProvider('test-provider-b'));
  registry.register(
    createMockProvider('test-unavailable', { available: false }),
  );
  return registry;
}

async function createConnectedClient(registry?: ProviderRegistry) {
  const reg = registry ?? createTestRegistry();
  const server = createTokenleakServer(reg);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Server', () => {
  it('lists all 8 tools', async () => {
    const { client } = await createConnectedClient();

    const result = await client.listTools();

    expect(result.tools).toHaveLength(8);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'compare_periods',
      'get_cost_breakdown',
      'get_daily_usage',
      'get_efficiency_advice',
      'get_receipt_lines',
      'get_streaks_and_habits',
      'get_usage_summary',
      'list_providers',
    ]);
  });

  it('lists all resources', async () => {
    const { client } = await createConnectedClient();

    const result = await client.listResources();

    expect(result.resources.length).toBeGreaterThanOrEqual(1);
    const uris = result.resources.map((r) => r.uri);
    expect(uris).toContain('tokenleak://overview');
  });

  it('lists resource templates for parameterized resources', async () => {
    const { client } = await createConnectedClient();

    const result = await client.listResourceTemplates();

    expect(result.resourceTemplates.length).toBeGreaterThanOrEqual(1);
    const uriTemplates = result.resourceTemplates.map((r) => r.uriTemplate);
    expect(uriTemplates).toContain('tokenleak://provider/{name}');
  });

  it('calls list_providers and returns correct structure', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'list_providers',
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');

    const parsed = JSON.parse(content[0]!.text) as Array<{
      name: string;
      displayName: string;
      available: boolean;
    }>;
    expect(parsed).toHaveLength(3);

    const providerA = parsed.find((p) => p.name === 'test-provider-a');
    expect(providerA).toBeDefined();
    expect(providerA!.available).toBe(true);

    const unavailable = parsed.find((p) => p.name === 'test-unavailable');
    expect(unavailable).toBeDefined();
    expect(unavailable!.available).toBe(false);
  });

  it('calls get_usage_summary and returns aggregated data', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'get_usage_summary',
      arguments: { days: 30 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.dateRange).toBeDefined();
    expect(parsed.aggregated).toBeDefined();
    expect(parsed.aggregated.totalTokens).toBeGreaterThan(0);
    expect(parsed.aggregated.totalCost).toBeGreaterThan(0);
    expect(parsed.providers).toHaveLength(2); // only available providers
    expect(parsed.providers[0].name).toBe('test-provider-a');
  });

  it('calls get_daily_usage and returns daily array', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'get_daily_usage',
      arguments: { days: 7 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.dateRange).toBeDefined();
    expect(Array.isArray(parsed.daily)).toBe(true);
  });

  it('calls get_cost_breakdown and returns model costs', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'get_cost_breakdown',
      arguments: { days: 30 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.dateRange).toBeDefined();
    expect(parsed.totalCost).toBeGreaterThan(0);
    expect(Array.isArray(parsed.models)).toBe(true);
  });

  it('calls get_streaks_and_habits and returns streak data', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'get_streaks_and_habits',
      arguments: { days: 30 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.dateRange).toBeDefined();
    expect(typeof parsed.currentStreak).toBe('number');
    expect(typeof parsed.longestStreak).toBe('number');
    expect(Array.isArray(parsed.dayOfWeek)).toBe(true);
    expect(parsed.sessionMetrics).toBeDefined();
  });

  it('calls compare_periods and returns deltas', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'compare_periods',
      arguments: {
        current_since: '2025-01-01',
        current_until: '2025-01-31',
        previous_since: '2024-12-01',
        previous_until: '2024-12-31',
      },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.periodA).toBeDefined();
    expect(parsed.periodB).toBeDefined();
    expect(parsed.deltas).toBeDefined();
    expect(typeof parsed.deltas.tokens).toBe('number');
    expect(typeof parsed.deltas.cost).toBe('number');
  });

  it('rejects invalid compare_periods ranges', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'compare_periods',
      arguments: {
        current_since: '2025-02-30',
        current_until: '2025-01-31',
        previous_since: '2024-12-01',
        previous_until: '2024-12-31',
      },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Invalid since date');
  });

  it('calls get_efficiency_advice and returns advisor report', async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({
      name: 'get_efficiency_advice',
      arguments: { days: 30 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.recommendations).toBeDefined();
    expect(Array.isArray(parsed.recommendations)).toBe(true);
    expect(typeof parsed.totalCurrentMonthlyCost).toBe('number');
    expect(typeof parsed.totalMonthlySavings).toBe('number');
    expect(typeof parsed.analyzedDays).toBe('number');
  });

  it('handles empty registry gracefully for get_usage_summary', async () => {
    const emptyRegistry = new ProviderRegistry();
    const { client } = await createConnectedClient(emptyRegistry);

    const result = await client.callTool({
      name: 'get_usage_summary',
      arguments: { days: 30 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);

    expect(parsed.providers).toEqual([]);
    expect(parsed.aggregated).toBeNull();
    expect(parsed.message).toContain('No provider data');
  });

  it('reads the overview resource', async () => {
    const { client } = await createConnectedClient();

    const result = await client.readResource({
      uri: 'tokenleak://overview',
    });

    expect(result.contents).toHaveLength(1);
    const content = result.contents[0]!;
    expect(content.mimeType).toBe('application/json');
    expect(typeof content.text).toBe('string');

    const parsed = JSON.parse(content.text as string);
    expect(parsed.schemaVersion).toBeDefined();
    expect(parsed.dateRange).toBeDefined();
  });
});
