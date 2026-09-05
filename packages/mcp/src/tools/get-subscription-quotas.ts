import type { QuotaProvider } from '@tokenleak/core';
import { quotaClient, type QuotaClient } from '@tokenleak/registry';
/** Explicit live capacity query, separate from historical usage tools. */
export async function handleGetSubscriptionQuotas(
  args: { provider?: QuotaProvider; refresh?: boolean },
  client: QuotaClient = quotaClient,
) {
  try {
    const snapshot = await client.load(args.provider ? [args.provider] : undefined, args.refresh);
    return { content: [{ type: 'text' as const, text: JSON.stringify(snapshot, null, 2) }] };
  } catch {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'Unable to read subscription quotas.' }],
    };
  }
}
