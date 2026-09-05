import { quotaClient, type QuotaClient } from '@tokenleak/registry';
import type { AppState } from './state';
/** Refresh independently from history; deduplicate clicks and always clear loading. */
export async function refreshQuotas(
  state: AppState,
  client: QuotaClient = quotaClient,
  refresh = false,
): Promise<void> {
  if (state.quotasLoading) return;
  state.quotasLoading = true;
  state.quotasError = null;
  try {
    state.quotaSnapshot = await client.load(undefined, refresh);
  } catch {
    state.quotasError = 'Could not load subscription quotas. Press r to retry.';
  } finally {
    state.quotasLoading = false;
  }
}

/** Refresh only while the quota view is visible; caller owns lifecycle cleanup. */
export function startQuotaPolling(
  state: AppState,
  onChange: () => void,
  client: QuotaClient = quotaClient,
  intervalMs = 60_000,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (
      state.selectedView !== 'quotas' ||
      state.showHelp ||
      state.showCursorSetup ||
      state.quotasLoading
    )
      return;
    void refreshQuotas(state, client).then(() => {
      if (!stopped) onChange();
    });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
