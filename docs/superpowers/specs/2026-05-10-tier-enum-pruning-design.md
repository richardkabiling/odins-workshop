# Tier-Scenario Enumeration Optimizer: Pruning, Web Workers, and Progress Bar

## Context

The current `solveTierEnum` (`src/solver/tierEnum.ts`, 300 LOC) implements tier-scenario enumeration in its bare form: enumerate `(minTier_attack, minTier_defense) ∈ {1..10}²`, build a per-scenario joint ILP (linear because the per-scenario set bonus is fixed), and pick the best. It is correct but in practice slow and unresponsive:

- **100 sequential MIP solves** on the main thread. Each is ~1000–2000 binaries (50 statue-slots × ~10 feathers × 11–20 tiers). Empirically 1–10s each → total run blocks the UI for tens of seconds to minutes.
- **No pruning** beyond GLPK's natural infeasibility detection. Most high-(min_a, min_d) scenarios are pool-infeasible and waste time entering BB.
- **No incumbent cutoff**. The greedy two-step is already a strong feasible point, but tierEnum re-solves from scratch with no lower bound to short-circuit weaker scenarios.
- **No progress feedback** in the UI. The user sees only `Optimizing…`.

This spec refactors `tierEnum.ts` to: (a) seed an incumbent from the greedy two-step, (b) prune scenarios via cheap feasibility and LP-relaxation upper bounds, (c) run surviving scenarios in a Web Worker pool, (d) polish the winner with `iterateUpgrades` to recover heterogeneous per-statue minTiers, and (e) stream progress to a new progress-bar UI element with a Cancel button. The output Solution shape stays unchanged.

## Approach

Four layers:

1. **Algorithmic pruning** — cut the work each scenario does (or skip it entirely).
2. **Worker pool** — parallelize remaining scenarios across `min(navigator.hardwareConcurrency, 4)` workers.
3. **Heterogeneous-minTier polish** — run `iterateUpgrades` on the tier-enum winner to allow per-statue minTier divergence (each statue independently lifts when profitable).
4. **Progress reporting + cancel** — thread `onProgress(done, total, currentBestScore)` and an `AbortSignal` from `tierEnum` → `optimize` → `App` → `OptimizationControls`. UI gets a `<progress>` bar and a Cancel button.

### Algorithmic pruning, in order

For each `(ta, td)` scenario:

1. **Cheapest-cost feasibility precheck (analytical, microseconds).** Compute the minimum pool spend that *any* feasible solution must incur:
   - For each kind, identify the 4 cheapest orange feathers + 1 cheapest purple at tier `ta`/`td` (this is `kindMinTier`), summed across all 5 statues.
   - Tally per conversion set; if any set's required minimum exceeds `pool[set]`, the scenario is infeasible and skipped immediately.
   - Note: feathers must be unique-within-a-statue but can repeat across statues, so the same cheapest feather per (rarity, set) can be used 5 times. Per-set minimum is then `5 × tierCost(cheapest_feather_in_set)` — straightforward.

2. **LP relaxation upper bound (~10–100ms per scenario).** Build the same scenario model with `binaries: []` (continuous relaxation) and `solve()`. The LP optimum is a valid upper bound on the MIP optimum.
   - If `lpUB ≤ incumbentScore`, skip the MIP solve entirely.
   - Use the `presolve: true, msglev: GLP_MSG_OFF` options for speed.

3. **MIP solve.** Only reached if both prechecks pass. Returns optimal scenario solution; update incumbent if better.

Greedy two-step is run **first** as a warm-start — its score becomes the initial incumbent. This catches the structural "tight" scenarios early and prunes most loose ones via LP cutoff.

### Heterogeneous-minTier polish

Tier-enum forces all 5 attack statues to share `ta` (and similarly defense). Real optima often want heterogeneous per-statue minTiers (e.g. 4 attack statues at minTier=10, 1 at minTier=5 to free pool budget). Closes this gap with a post-pass that **reuses `iterateUpgrades` from `src/solver/step2.ts`** unchanged:

- Take tier-enum's winning solution as the starting state for `iterateUpgrades`.
- The greedy loop's existing `'single'` and `'lift'` moves do both refinements:
  - **Single** (per-feather tier bump above min) — refines within-statue tier choice; tier-enum locks tiers to maximize a fixed scenario but the polish can spend leftover pool on individual feather upgrades.
  - **Lift** (raise every feather currently at a statue's `minTier`) — exactly the heterogeneous minTier move. Independently raises each statue's minTier when its `Δscore / fractional-pressure` ratio justifies it.
- Score is monotone non-decreasing (greedy only accepts improving moves), so polish never makes the solution worse.
- Pool budget is enforced inside `iterateUpgrades` (`step2.ts:92, 110-113`) — no double-spending risk.

Implementation: in `optimize.ts`'s `runTierEnum`, after `solveTierEnum` returns, call `iterateUpgrades(tierEnumState, statWeights, normFactors)` and `totalScore(...)` on the result. Replace the `attack`, `defense`, `poolRemaining`, and `score` of the returned `Solution` with the polished values.

### Web Worker pool

Workers are vanilla Vite `?worker` modules — Vite handles bundling glpk.js into the worker. Each worker:

- Imports `glpk.js` and the scenario builder (extracted from `tierEnum.ts` into a pure helper).
- Receives `{ scenarioId, ta, td, poolInitial, statWeights, normFactors, incumbent }` messages.
- Runs feasibility precheck → LP cutoff → MIP solve (or short-circuits).
- Posts back `{ scenarioId, status, score?, vars? }`.

Pool implementation (`src/solver/workerPool.ts`, new ~80 LOC):

- Spawn `N = Math.min(navigator.hardwareConcurrency ?? 4, 4)` workers at pool init.
- Maintain a FIFO queue of pending scenarios; assign next scenario to next idle worker.
- Bundle the **latest incumbent** with each dispatch (so LP cutoff tightens as the run progresses; staleness is a perf-only concern, never a correctness issue).
- Expose `cancel()` that drops the queue and posts a 'terminate' to in-flight workers.
- Pre-spawn workers eagerly at first use to amortize the WASM-load cost (~50–200ms each, paid once).

### Progress reporting

Plumb a callback through the call chain:

```ts
type Progress = { done: number; total: number; bestScore: number | null };

// solver layer
solveTierEnum(..., options?: { onProgress?: (p: Progress) => void; signal?: AbortSignal })

// orchestrator
optimize(inv, ranking, mode, options?: { onProgress?: ...; signal?: ... })

// App.tsx
const [progress, setProgress] = useState<Progress | null>(null);
// pass setProgress as onProgress
```

UI: `OptimizationControls` shows a `<progress value={done} max={total} />` plus a one-line summary: `"23 / 64 scenarios · best so far 3,142"`. When `progress === null` (greedy mode) it shows the existing `Optimizing…` text only.

**Cancel button**: while `loading === true` and `mode === 'tier-enum'`, render a "Cancel" button next to the disabled "Optimize" button. Clicking it calls `abortController.abort()`. The optimizer catches the abort, terminates pending workers, and resolves with the best-so-far solution (still polished via `iterateUpgrades`). If no scenarios have completed yet, falls back to the greedy warm-start solution.

## Critical files

### Modified

- **`src/solver/tierEnum.ts`** — refactor:
  - Extract `buildScenarioModel()` and `extractSolution()` so they can run in a Worker (no React/window deps; pure data-in/data-out).
  - Add `feasibilityPrecheck(ta, td, pool, eligibles)` analytical helper.
  - Add `lpRelaxationUpperBound(model)` — re-solves with `binaries` removed.
  - Replace the sequential `for ta…for td` loop with a worker-pool dispatch.
  - Accept `options: { incumbentScore?: number; onProgress?: ...; signal?: AbortSignal }`.
  - Export `MAX_ENUM_TIER` increased from 10 → 20 (pruning makes the tail cheap).

- **`src/solver/optimize.ts`** — pass options through to `solveTierEnum`. For the `tier-enum` mode:
  1. Run greedy two-step first (`solveT1Setup` + `iterateUpgrades`) to seed the incumbent and provide a fallback if all scenarios are pruned or the user cancels early.
  2. Run `solveTierEnum` with that warm-start score.
  3. Run `iterateUpgrades` on tier-enum's winning state as the polish pass.
  4. Return the polished solution. If tier-enum returned `null` (all infeasible) or the user aborted before any improvement, return the greedy warm-start.

- **`src/App.tsx`** — add `progress` state, `abortControllerRef` (kept across renders so `handleCancel` can abort the in-flight run), `onProgress` callback. Pass `progress` and `onCancel` to `OptimizationControls`. Reset progress to `null` after each run completes; abort on unmount and on `handleClear`.

- **`src/ui/OptimizationControls.tsx`** — accept optional `progress: Progress | null` and `onCancel?: () => void` props. Render `<progress>` + summary line when `loading && progress`. Render a "Cancel" button next to the disabled "Optimize" button when `onCancel` is provided and `loading === true`.

### New

- **`src/solver/tierEnumWorker.ts`** — Web Worker entry point. Imports glpk.js, the builder/precheck helpers from `tierEnum.ts` (or a shared `tierEnumModel.ts` if circular imports are an issue). Receives a scenario message, runs the three-stage pipeline (precheck → LP cutoff → MIP), posts result.

- **`src/solver/workerPool.ts`** — generic-ish worker pool. Probably ~80 LOC: queue, `dispatch(task) → Promise<result>`, `cancel()`.

### Reused (no changes)

- `src/solver/glpk.ts` — wrapper already supports omitting `binaries` (treated as continuous LP).
- `src/solver/step1.ts`, `src/solver/step2.ts` — used to compute the warm-start incumbent.
- `src/domain/scoring.ts`, `src/domain/ranking.ts`, `src/data/feathers.generated.ts`, `src/data/setBonuses.generated.ts` — unchanged.

### Configuration

- **`vite.config.ts`** — verify `worker.format: 'es'` (default in modern Vite) so the worker can `import GLPK from 'glpk.js'`. If glpk.js's CJS-only build trips Vite's worker bundler, fall back to importing from `glpk.js/dist/glpk.min.js` directly.

## Pseudo-flow for new `solveTierEnum`

```ts
async function solveTierEnum(pool, weights, normA, normD, options) {
  // 1. Warm start
  let incumbent = options.incumbentScore ?? -Infinity;
  let bestSol = options.warmStartSolution ?? null;

  // 2. Generate + feasibility-prune scenarios
  const scenarios: { ta: number; td: number }[] = [];
  for (let ta = 1; ta <= MAX_ENUM_TIER; ta++) {
    for (let td = 1; td <= MAX_ENUM_TIER; td++) {
      if (!feasibilityPrecheck(ta, td, pool)) continue;
      scenarios.push({ ta, td });
    }
  }

  // 3. Sort by promise (heuristic: higher minTier first → bigger bonuses, but more expensive)
  scenarios.sort(byEstimatedPotential);

  // 4. Worker pool dispatch
  const wp = new WorkerPool('/src/solver/tierEnumWorker.ts');
  let done = 0;
  options.onProgress?.({ done, total: scenarios.length, bestScore: bestSol?.score ?? null });

  await wp.runAll(
    scenarios.map(s => async () => ({
      ...s,
      result: await wp.dispatch({ ...s, pool, weights, normA, normD, incumbent }),
    })),
    {
      onResult: ({ ta, td, result }) => {
        done++;
        if (result.kind === 'mipOptimal' && result.score > incumbent) {
          incumbent = result.score;
          bestSol = decodeSolution(result.vars, ta, td, ...);
        }
        options.onProgress?.({ done, total: scenarios.length, bestScore: incumbent });
      },
      signal: options.signal,
    },
  );

  wp.terminate();
  return bestSol;
}
```

Per-worker pipeline:

```ts
function processScenario(msg) {
  const eligibleA = eligibleFeathers('attack');
  const eligibleD = eligibleFeathers('defense');

  // (a) feasibility precheck (was already done on main thread, but cheap to re-verify)
  if (!feasibilityPrecheck(msg.ta, msg.td, msg.pool, eligibleA, eligibleD)) {
    return { kind: 'infeasible' };
  }

  const model = buildScenarioModel(msg.ta, msg.td, msg.pool, msg.weights, msg.normA, msg.normD);

  // (b) LP relaxation upper bound
  const lp = await solve({ ...model, binaries: [] });
  if (lp.result.status !== 5 || lp.result.z <= msg.incumbent) {
    return { kind: 'lpCutoff', lpUB: lp.result.z ?? null };
  }

  // (c) MIP solve
  const mip = await solve(model);
  if (mip.result.status !== 5) return { kind: 'mipInfeasible' };

  return { kind: 'mipOptimal', score: mip.result.z, vars: mip.result.vars };
}
```

## Verification

End-to-end checks before declaring done:

1. **Correctness regression**: on 5–10 fixture inventories, assert `tier-enum-polished.score ≥ tier-enum-raw.score ≥ greedy.score - 1e-6` always (each layer monotone non-decreasing). At least one fixture must show tier-enum-raw strictly better than greedy, and at least one must show polish strictly better than tier-enum-raw — otherwise the corresponding layer isn't pulling its weight.
2. **Pruning effectiveness**: log `feasibility-skipped`, `lp-skipped`, `mip-solved` counts. Expect feasibility pruning to drop most high-tier scenarios; LP pruning to skip a meaningful fraction of remaining.
3. **Performance**: typical inventories complete in < 30s wall-clock (4 workers). Worst case acceptable up to 60s. Run a hand-timed bench on 3 fixtures (small/medium/full inventory).
4. **Progress UX**: `npm run dev`, switch to optimize tab with a real inventory, click Optimize in `tier-enum` mode, visually verify the progress bar advances smoothly and the running best score updates as scenarios finish.
5. **Cancel**: click the Cancel button mid-run; verify the optimize promise resolves within ~1s with either the current best (post-polish) or the greedy warm-start if no scenarios completed.
6. **Pool budget invariant**: `Σ totalCost(chosen feathers) ≤ pool[set]` for every conversion set in the returned solution.
7. **minTier consistency**: `template.minTier === min(template.feathers.map(f => f.tier))` for every statue.
8. **Score recomputation**: re-run `totalScore(...)` on the returned solution and assert it matches `bestSol.score` within 1e-6 (extractSolution already does this; preserve the check).
9. **LP-cutoff correctness sanity**: temporarily disable LP cutoff and re-run; final score must match (within tolerance) the run with cutoff enabled. This is a one-time guard test.
10. **Worker import smoke test**: `npm run build` succeeds and the production bundle includes a worker chunk; load the production preview and confirm tier-enum works.

## Decisions locked in

- Cancel button: yes, render next to "Optimize" while a `tier-enum` run is loading.
- `MAX_ENUM_TIER`: 20 (up from 10).
- Heterogeneous-minTier polish via `iterateUpgrades`: included in this spec.
- Warm-start incumbent for `joint-mip` mode: out of scope; same pattern could be applied later.

## Risks

- **Worker bundling.** Vite + glpk.js inside a Worker may need `?worker&inline` or a small wrapper if the package's CJS form fights ESM. Validate early with a smoke test before refactoring `tierEnum.ts`. Fallback: skip workers, run sequentially with `requestIdleCallback` to keep UI responsive.
- **Worker startup cost.** ~50–200ms per worker × 4 = up to 800ms upfront. Pre-spawn lazily on first optimize click; subsequent runs reuse the pool.
- **LP relaxation looseness.** For some scenarios, LP UB ≫ MIP optimum, making cutoff ineffective. Acceptable: just falls through to MIP. Worst case: equivalent to the current sequential solver, plus pruning overhead.
- **SharedArrayBuffer not used.** Incumbent broadcast is via per-message bundling, not shared memory. Slightly stale incumbents reduce cutoff effectiveness but never affect correctness.
- **Polish only does monotone moves from a single seed.** `iterateUpgrades` is greedy; it can't downgrade or swap feathers. If the tier-enum winner is in a basin that needs a feather swap to escape, polish won't help. Acceptable: the joint-MIP mode (already implemented) covers that case for users who want it.
