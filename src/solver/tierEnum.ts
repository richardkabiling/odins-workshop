/**
 * Tier-scenario enumeration optimizer (v2 — worker pool + pruning).
 *
 * For each feasible (minTier_A, minTier_B) ∈ {1..MAX_ENUM_TIER}², dispatches a
 * per-scenario MIP to a Web Worker.  Each worker runs:
 *   1. Feasibility precheck (analytical, microseconds)
 *   2. LP relaxation upper bound (milliseconds) — skips MIP if LP ≤ incumbent
 *   3. Full MIP solve
 *
 * The main thread collects results, updates the incumbent, fires onProgress,
 * and returns the best solution found.
 */
import type { ConversionSet, StatKey, StatueTemplate, TierEnumProgress } from '../domain/types';
import {
  feasibilityPrecheck,
  extractSolution,
  sortScenariosByPotential,
} from './tierEnumModel';
import { WorkerPool } from './workerPool';
import type { ScenarioRequest } from './workerPool';

export const MAX_ENUM_TIER = 20;

export interface TierEnumSolution {
  attack: StatueTemplate[];
  defense: StatueTemplate[];
  poolRemaining: Partial<Record<ConversionSet, number>>;
  score: number;
}

export interface TierEnumOptions {
  /** Initial incumbent score (from greedy warm-start). Enables early LP cutoff. */
  incumbentScore?: number;
  /** Initial incumbent solution (from greedy warm-start). Used as fallback if aborted early. */
  warmStartSolution?: TierEnumSolution;
  /** Called after each scenario completes (pruned or solved). */
  onProgress?: (p: TierEnumProgress) => void;
  /** When aborted, stops dispatching and returns best solution found so far. */
  signal?: AbortSignal;
}

/**
 * Factory for the real tierEnumWorker.
 * Using `new URL(...)` tells Vite to bundle the worker as a separate chunk.
 */
function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./tierEnumWorker.ts', import.meta.url), { type: 'module' });
}

/**
 * Run the tier-scenario enumeration optimizer.
 *
 * @param workerFactory - injectable factory for testing; defaults to the real worker.
 */
export async function solveTierEnum(
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Partial<Record<StatKey, number>>,
  attackNormFactors: Partial<Record<StatKey, number>>,
  defenseNormFactors: Partial<Record<StatKey, number>>,
  options: TierEnumOptions = {},
  workerFactory: () => Worker = defaultWorkerFactory,
): Promise<TierEnumSolution | null> {
  const {
    incumbentScore = -Infinity,
    warmStartSolution = null,
    onProgress,
    signal,
  } = options;

  let incumbent = incumbentScore;
  let best: TierEnumSolution | null = warmStartSolution ?? null;

  // 1. Generate all candidate (ta, td) pairs
  const allScenarios: { ta: number; td: number }[] = [];
  for (let ta = 1; ta <= MAX_ENUM_TIER; ta++) {
    for (let td = 1; td <= MAX_ENUM_TIER; td++) {
      allScenarios.push({ ta, td });
    }
  }

  // 2. Feasibility precheck on main thread (cheap analytical filter)
  const feasibleScenarios = allScenarios.filter(s =>
    feasibilityPrecheck(s.ta, s.td, poolInitial),
  );

  // 3. Sort by potential: higher minTier sum first (bigger bonuses, LP cutoff kicks in faster)
  const scenarios = sortScenariosByPotential(feasibleScenarios);

  const total = scenarios.length;
  let done = 0;
  onProgress?.({ done, total, bestScore: best?.score ?? null });

  if (total === 0) return best;

  // 4. Worker pool dispatch
  const workerCount = Math.min(
    typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4,
    4,
  );
  const pool = new WorkerPool(workerFactory, workerCount);

  // Dispatch all scenarios; the pool queues them and feeds workers one at a time.
  // Each dispatch call re-reads `incumbent` from the closure so later tasks
  // benefit from a tighter LP cutoff as results arrive.
  const requests: Promise<void>[] = scenarios.map((scenario, i) => {
    const req: ScenarioRequest = {
      scenarioId: i,
      ta: scenario.ta,
      td: scenario.td,
      pool: poolInitial,
      statWeights,
      attackNormFactors,
      defenseNormFactors,
      incumbent,
    };

    return pool.dispatch(req).then(resp => {
      done++;

      if (resp.kind === 'mip-optimal' && resp.score > incumbent) {
        incumbent = resp.score;
        best = extractSolution(
          resp.vars,
          resp.ta,
          resp.td,
          poolInitial,
          statWeights,
          attackNormFactors,
          defenseNormFactors,
        );
      }

      onProgress?.({ done, total, bestScore: best?.score ?? null });
    });
  });

  // Wait for all, respecting abort signal
  if (signal) {
    await Promise.race([
      Promise.all(requests),
      new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
    ]);
  } else {
    await Promise.all(requests);
  }

  pool.terminate();
  return best;
}
