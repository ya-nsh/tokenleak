import { expect, test } from 'bun:test';
import { QuotaClient } from '@tokenleak/registry';
import { handleGetSubscriptionQuotas } from './get-subscription-quotas';
test('MCP returns sanitized structured quota states with a provider filter', async () => {
  const client = new QuotaClient({
    credential: async () => null,
    now: () => 0,
    fetch: globalThis.fetch,
  });
  const result = await handleGetSubscriptionQuotas({ provider: 'claude' }, client);
  const snapshot = JSON.parse(result.content[0]!.text);
  expect(snapshot.providers).toHaveLength(1);
  expect(snapshot.providers[0].status).toBe('not-configured');
});
