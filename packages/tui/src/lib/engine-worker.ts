/// <reference lib="webworker" />
import { EngineCore } from './engine-core.js';
import { handleEngineRequest, isEngineRequest } from './engine-protocol.js';

declare const self: Worker;

const engine = new EngineCore();

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!isEngineRequest(event.data)) return;
  const { id } = event.data;
  void handleEngineRequest(engine, event.data).then((response) => {
    try {
      self.postMessage(response);
    } catch (error: unknown) {
      // A result that cannot be cloned must still settle the caller's promise.
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ id, ok: false, error: `Could not send result: ${message}` });
    }
  });
};
