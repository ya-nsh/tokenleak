import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EngineCore } from './engine-core.js';
import { handleEngineRequest, isEngineResponse } from './engine-protocol.js';
import type { EngineArgs, EngineMethod, EngineResult } from './engine-protocol.js';
import type { ReportKind, ReportRequest, ReportResults } from './engine-core.js';

/** The TUI's handle on the data engine, wherever it runs. */
export interface DataEngine {
  call<M extends EngineMethod>(method: M, ...args: EngineArgs<M>): Promise<EngineResult<M>>;
  /** One report, typed by its kind (the generic is lost crossing `call`). */
  report<K extends ReportKind>(request: ReportRequest<K>): Promise<ReportResults[K] | null>;
  /** True when the engine runs in a worker, false for the in-process fallback. */
  readonly isolated: boolean;
  dispose(): void;
}

/**
 * Worker entry candidates next to this module: the TypeScript source when run
 * from `src`, the compiled file in a package `dist`, and the separate file the
 * npm bundle ships beside `tokenleak` (see `scripts/build-npm.ts`).
 */
export const ENGINE_WORKER_FILES = ['./engine-worker.ts', './engine-worker.js', './tokenleak-engine.js'] as const;

export function resolveEngineWorkerUrl(base: string = import.meta.url): URL | null {
  for (const name of ENGINE_WORKER_FILES) {
    const url = new URL(name, base);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

abstract class BaseEngine {
  abstract call<M extends EngineMethod>(method: M, ...args: EngineArgs<M>): Promise<EngineResult<M>>;

  async report<K extends ReportKind>(request: ReportRequest<K>): Promise<ReportResults[K] | null> {
    return (await this.call('report', request)) as ReportResults[K] | null;
  }
}

class WorkerEngine extends BaseEngine implements DataEngine {
  readonly isolated = true;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private failure: Error | null = null;
  private crashed = false;
  private replied = false;

  constructor(private readonly worker: Worker) {
    super();
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!isEngineResponse(event.data)) return;
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      this.replied = true;
      if (event.data.ok) pending.resolve(event.data.value);
      else pending.reject(new Error(event.data.error));
    };
    worker.onerror = (event: ErrorEvent) => {
      this.crashed = true;
      this.fail(new Error(`Data engine stopped: ${event.message}`));
    };
  }

  call<M extends EngineMethod>(method: M, ...args: EngineArgs<M>): Promise<EngineResult<M>> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise<EngineResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, method, args });
    });
  }

  /** The worker died without ever answering: it most likely could not load at all. */
  get failedToStart(): boolean {
    return this.crashed && !this.replied;
  }

  dispose(): void {
    this.fail(new Error('Data engine was shut down'));
    this.worker.terminate();
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

class InProcessEngine extends BaseEngine implements DataEngine {
  readonly isolated = false;
  private readonly core = new EngineCore();
  private nextId = 1;

  async call<M extends EngineMethod>(method: M, ...args: EngineArgs<M>): Promise<EngineResult<M>> {
    const response = await handleEngineRequest(this.core, { id: this.nextId++, method, args });
    if (!response.ok) throw new Error(response.error);
    return response.value as EngineResult<M>;
  }

  dispose(): void {
    void this.core.stopLiveSite();
  }
}

/** Uses the worker engine, switching to an in-process one if the worker never starts. */
class FallbackEngine extends BaseEngine implements DataEngine {
  private current: WorkerEngine | InProcessEngine;
  private disposed = false;

  constructor(worker: WorkerEngine) {
    super();
    this.current = worker;
  }

  get isolated(): boolean {
    return this.current.isolated;
  }

  async call<M extends EngineMethod>(method: M, ...args: EngineArgs<M>): Promise<EngineResult<M>> {
    const engine = this.current;
    try {
      return await engine.call(method, ...args);
    } catch (error: unknown) {
      if (this.disposed || !(engine instanceof WorkerEngine) || !engine.failedToStart) throw error;
      if (this.current === engine) {
        engine.dispose();
        this.current = new InProcessEngine();
      }
      return this.current.call(method, ...args);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.current.dispose();
  }
}

/**
 * Starts the data engine in a worker so loading and report building never
 * block input or rendering. Falls back to running it in-process when no
 * worker entry is found or the runtime refuses to start one.
 */
export function createDataEngine(options: { preferWorker?: boolean; workerUrl?: URL } = {}): DataEngine {
  if (options.preferWorker !== false) {
    const url = options.workerUrl ?? resolveEngineWorkerUrl();
    if (url) {
      try {
        // Workers start from the launch environment; pass the current one so
        // overrides set since then (cache paths, provider directories) apply.
        const worker = new Worker(url.href, { env: { ...process.env } } as WorkerOptions);
        return new FallbackEngine(new WorkerEngine(worker));
      } catch {
        // Fall through to the in-process engine.
      }
    }
  }
  return new InProcessEngine();
}
