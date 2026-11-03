import type { EngineCore } from './engine-core.js';

/** Engine methods callable across the worker boundary. */
export type EngineMethod =
  | 'loadCached'
  | 'loadFresh'
  | 'setFilter'
  | 'report'
  | 'exportImage'
  | 'llmPrompt'
  | 'openLiveSite'
  | 'stopLiveSite';

export type EngineArgs<M extends EngineMethod> = Parameters<EngineCore[M]>;
export type EngineResult<M extends EngineMethod> = Awaited<ReturnType<EngineCore[M]>>;

export interface EngineRequestMessage<M extends EngineMethod = EngineMethod> {
  id: number;
  method: M;
  args: EngineArgs<M>;
}

export type EngineResponseMessage =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

const ENGINE_METHODS: ReadonlySet<string> = new Set<EngineMethod>([
  'loadCached',
  'loadFresh',
  'setFilter',
  'report',
  'exportImage',
  'llmPrompt',
  'openLiveSite',
  'stopLiveSite',
]);

export function isEngineRequest(value: unknown): value is EngineRequestMessage {
  if (value === null || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message['id'] === 'number' &&
    typeof message['method'] === 'string' &&
    ENGINE_METHODS.has(message['method']) &&
    Array.isArray(message['args'])
  );
}

export function isEngineResponse(value: unknown): value is EngineResponseMessage {
  if (value === null || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message['id'] === 'number' &&
    (message['ok'] === true || (message['ok'] === false && typeof message['error'] === 'string'))
  );
}

/** Runs one request against an engine and packages the outcome as a response. */
export async function handleEngineRequest(
  engine: EngineCore,
  request: EngineRequestMessage,
): Promise<EngineResponseMessage> {
  try {
    const method = engine[request.method] as (...args: unknown[]) => Promise<unknown>;
    const value = await method.apply(engine, request.args);
    return { id: request.id, ok: true, value };
  } catch (error: unknown) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
