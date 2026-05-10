// src/solver/workerPool.ts
import type { ConversionSet, StatKey } from '../domain/types';

/** Message sent from the main thread to each worker. */
export interface ScenarioRequest {
  scenarioId: number;
  ta: number;
  td: number;
  pool: Partial<Record<ConversionSet, number>>;
  statWeights: Partial<Record<StatKey, number>>;
  attackNormFactors: Partial<Record<StatKey, number>>;
  defenseNormFactors: Partial<Record<StatKey, number>>;
  /** Current best score — used by the worker for the LP cutoff check. */
  incumbent: number;
}

/** Message posted back from a worker to the main thread. */
export type ScenarioResponse =
  | { scenarioId: number; kind: 'feasibility-skip' }
  | { scenarioId: number; kind: 'lp-skip'; lpUB: number }
  | { scenarioId: number; kind: 'mip-infeasible' }
  | { scenarioId: number; kind: 'mip-optimal'; score: number; vars: Record<string, number>; ta: number; td: number }
  | { scenarioId: number; kind: 'error'; message: string };

type WorkerFactory = () => Worker;

interface QueueEntry {
  req: ScenarioRequest;
  resolve: (resp: ScenarioResponse) => void;
}

/**
 * A fixed-size worker pool with a FIFO queue.
 *
 * Each worker handles exactly one task at a time; the next task is dispatched
 * only when the worker posts its response. This prevents flooding a worker
 * with many concurrent WASM solves (which would serialize anyway but block
 * response posting until all drain).
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: QueueEntry[] = [];
  private pending = new Map<number, (resp: ScenarioResponse) => void>();

  constructor(factory: WorkerFactory, workerCount = 1) {
    for (let i = 0; i < workerCount; i++) {
      const w = factory();
      w.onmessage = (e: MessageEvent<ScenarioResponse>) => {
        const resp = e.data;
        const resolve = this.pending.get(resp.scenarioId);
        if (resolve) {
          this.pending.delete(resp.scenarioId);
          resolve(resp);
        }
        // Worker is now idle — pick up next queued task, if any
        const next = this.queue.shift();
        if (next) {
          this.pending.set(next.req.scenarioId, next.resolve);
          w.postMessage(next.req);
        } else {
          this.idle.push(w);
        }
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  dispatch(req: ScenarioRequest): Promise<ScenarioResponse> {
    return new Promise(resolve => {
      const idleWorker = this.idle.shift();
      if (idleWorker) {
        // Send immediately to idle worker
        this.pending.set(req.scenarioId, resolve);
        idleWorker.postMessage(req);
      } else {
        // All workers busy — enqueue
        this.queue.push({ req, resolve });
      }
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
  }
}
