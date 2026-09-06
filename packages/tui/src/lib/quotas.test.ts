import { expect, test } from 'bun:test';
import { QuotaClient } from '@tokenleak/registry';
import { refreshQuotas } from './quotas';
import { createInitialState } from './state';
import { createQuotasPanel } from '../panels/quotas';
function texts(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const obj = node as Record<string, unknown>;
  const props = obj.props as Record<string, unknown> | undefined;
  return [
    ...(typeof props?.content === 'string' ? [props.content] : []),
    ...(Array.isArray(obj.children) ? obj.children.flatMap(texts) : []),
  ];
}
test('quota screen works with no history; duplicate refresh clears loading once', async () => {
  const state = createInitialState();
  let calls = 0;
  const client = new QuotaClient({
    credential: async () => {
      calls++;
      return null;
    },
    now: () => 0,
    fetch: globalThis.fetch,
  });
  await Promise.all([refreshQuotas(state, client), refreshQuotas(state, client)]);
  expect(calls).toBe(3);
  expect(state.quotasLoading).toBe(false);
  expect(state.data).toBeNull();
  expect(state.quotaSnapshot?.providers).toHaveLength(3);
  expect(texts(createQuotasPanel(state, 120, 40)).join('\n')).toContain('not-configured');
});
test('narrow panels wrap content and clamp scroll after resize', () => {
  const state = createInitialState();
  state.quotasScrollOffset = 1000;
  const contents = texts(createQuotasPanel(state, 40, 12));
  expect(contents.length).toBeLessThanOrEqual(9);
  expect(state.quotasScrollOffset).toBeLessThan(1000);
  expect(contents.slice(0, -1).every((line) => line.length <= 36)).toBe(true);
});
test('loading and error states visible without hiding setup', () => {
  const state = createInitialState();
  state.quotasLoading = true;
  expect(texts(createQuotasPanel(state)).join(' ')).toContain('Checking provider');
  state.quotasError = 'Try again';
  expect(texts(createQuotasPanel(state)).join(' ')).toContain('Try again');
});

test('polling is scoped to the visible quota view and stops on cleanup', async () => {
  const { startQuotaPolling } = await import('./quotas');
  const state = createInitialState();
  let calls = 0;
  let updates = 0;
  const client = new QuotaClient({
    credential: async () => {
      calls++;
      return null;
    },
    now: Date.now,
    fetch: globalThis.fetch,
  });
  const stop = startQuotaPolling(state, () => updates++, client, 5);
  try {
    await Bun.sleep(15);
    expect(calls).toBe(0);
    state.selectedView = 'quotas';
    await Bun.sleep(25);
    expect(calls).toBeGreaterThan(0);
    state.selectedView = 'overview';
    const previous = calls;
    await Bun.sleep(15);
    expect(calls).toBe(previous);
    stop();
    const beforeStop = updates;
    state.selectedView = 'quotas';
    await Bun.sleep(15);
    expect(updates).toBe(beforeStop);
  } finally {
    stop();
  }
});
