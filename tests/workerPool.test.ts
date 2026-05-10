// tests/workerPool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WorkerPool } from '../src/solver/workerPool';

/**
 * Build a fake Worker that immediately echoes the message back
 * with `kind: 'mip-infeasible'` (default) or custom override.
 */
function makeFakeWorker(override: (msg: unknown) => unknown = msg => ({
  ...(msg as object),
  kind: 'mip-infeasible',
})): Worker {
  let onmessageHandler: ((e: MessageEvent) => void) | null = null;
  return {
    get onmessage() { return onmessageHandler; },
    set onmessage(h: ((e: MessageEvent) => void) | null) { onmessageHandler = h; },
    postMessage(data: unknown) {
      // Simulate async: reply on next microtask
      Promise.resolve().then(() => {
        onmessageHandler?.({ data: override(data) } as MessageEvent);
      });
    },
    terminate: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onerror: null,
    onmessageerror: null,
  } as unknown as Worker;
}

describe('WorkerPool', () => {
  it('dispatches a task and receives a response', async () => {
    const workers = [makeFakeWorker()];
    const pool = new WorkerPool(() => workers[0]);

    const req = { scenarioId: 0, ta: 1, td: 1, pool: {}, statWeights: {}, attackNormFactors: {}, defenseNormFactors: {}, incumbent: 0 };
    const resp = await pool.dispatch(req);
    expect(resp.scenarioId).toBe(0);
    expect(resp.kind).toBe('mip-infeasible');

    pool.terminate();
  });

  it('dispatches multiple tasks concurrently using N workers', async () => {
    const workers = [makeFakeWorker(), makeFakeWorker()];
    let workerIndex = 0;
    const pool = new WorkerPool(() => workers[workerIndex++ % 2], 2);

    const results = await Promise.all([
      pool.dispatch({ scenarioId: 0, ta: 1, td: 1, pool: {}, statWeights: {}, attackNormFactors: {}, defenseNormFactors: {}, incumbent: 0 }),
      pool.dispatch({ scenarioId: 1, ta: 2, td: 2, pool: {}, statWeights: {}, attackNormFactors: {}, defenseNormFactors: {}, incumbent: 0 }),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].scenarioId).toBe(0);
    expect(results[1].scenarioId).toBe(1);

    pool.terminate();
  });

  it('terminate() calls terminate on all underlying workers', () => {
    const w = makeFakeWorker();
    const pool = new WorkerPool(() => w, 1);
    pool.terminate();
    expect(vi.mocked(w.terminate)).toHaveBeenCalled();
  });
});
