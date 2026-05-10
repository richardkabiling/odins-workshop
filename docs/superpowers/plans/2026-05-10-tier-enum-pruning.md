# Tier-Enum Pruning, Workers, and Progress Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `solveTierEnum` to add feasibility pruning + LP-relaxation incumbent cutoff with a greedy warm-start, parallelize via a Web Worker pool, add a `iterateUpgrades` polish pass to unlock heterogeneous per-statue minTiers, and surface progress + Cancel in the UI.

**Architecture:** Extract pure model-building helpers into `tierEnumModel.ts` (shared by main thread and Worker). A `WorkerPool` dispatches `{ ta, td, pool, weights, incumbent }` tasks to N workers; each worker runs feasibilityPrecheck → LP UB → MIP and posts back the result. The main thread collects results, updates incumbent, and fires `onProgress`. After all scenarios, `optimize.ts` runs `iterateUpgrades` on the winner as a polish pass that recovers heterogeneous per-statue minTiers. `StatRankerControls.tsx` renders a `<progress>` bar and Cancel button when `mode === 'tier-enum'`.

**Tech Stack:** React + TypeScript + GLPK.js + Vite Worker URL pattern + Vitest (node environment, `Worker` mocked in tests).

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/solver/tierEnumModel.ts` | Pure helpers: `eligibleFeathers`, `varName`, `scoreCoeff`, `buildScenarioModel`, `extractSolution`, `feasibilityPrecheck`. No browser/React deps — safe to import in Worker. |
| Create | `src/solver/workerPool.ts` | `WorkerPool` class: spawn N workers, queue tasks, route responses by `scenarioId`. |
| Create | `src/solver/tierEnumWorker.ts` | Worker entry point: imports model helpers + glpk.js, handles `ScenarioRequest` → `ScenarioResponse`. |
| Create | `tests/tierEnumModel.test.ts` | Unit tests: `feasibilityPrecheck`, `scoreCoeff`, `buildScenarioModel` column counts. |
| Modify | `src/solver/tierEnum.ts` | Thin orchestrator: generate + sort scenarios, dispatch to `WorkerPool`, collect results + progress. `MAX_ENUM_TIER` → 20. Accepts `TierEnumOptions`. |
| Modify | `src/solver/optimize.ts` | `runTierEnum`: warm-start greedy two-step, pass score to `solveTierEnum`, run `iterateUpgrades` polish. Add `OptimizeOptions` param. |
| Modify | `src/domain/types.ts` | Add `TierEnumProgress` and `OptimizeOptions` types. |
| Modify | `src/App.tsx` | `progress` state, `abortControllerRef`, `handleCancel`. Pass `onProgress`/`signal` to `optimize()`. Pass `progress`/`onCancel` to `StatRankerControls`. |
| Modify | `src/ui/StatRankerControls.tsx` | Accept `progress?: TierEnumProgress` and `onCancel?: () => void` props. Render progress bar + Cancel button when `mode === 'tier-enum'` and `loading`. |

---

## Task 1: Extract model helpers into `tierEnumModel.ts`

**Files:**
- Create: `src/solver/tierEnumModel.ts`
- Create: `tests/tierEnumModel.test.ts`

The current `tierEnum.ts` has `eligibleFeathers`, `varName`, `scoreCoeff`, `buildScenarioModel`, `extractSolution` all as local functions. Move them into a new pure module. Add `feasibilityPrecheck`. This lets the Worker import them without pulling in browser globals.

- [ ] **Step 1.1: Write the tests**

```ts
// tests/tierEnumModel.test.ts
import { describe, it, expect } from 'vitest';
import { feathers } from '../src/data/feathers.generated';
import { weightsFromRanking, DEFAULT_RANKING } from '../src/domain/ranking';
import { computeNormFactors } from '../src/solver/normFactors';
import {
  eligibleFeathers,
  feasibilityPrecheck,
  buildScenarioModel,
  scoreCoeff,
} from '../src/solver/tierEnumModel';

const weights = weightsFromRanking(DEFAULT_RANKING);
const normA = computeNormFactors(feathers, 'attack');
const normD = computeNormFactors(feathers, 'defense');

// Pool generous enough for most scenarios
const bigPool = { STDN: 9999, LD: 9999, DN: 9999, ST: 9999, Purple: 9999 };
// Pool with zero budget: nothing can be bought
const emptyPool = { STDN: 0, LD: 0, DN: 0, ST: 0, Purple: 0 };

describe('eligibleFeathers', () => {
  it('returns ≥4 orange and ≥1 purple for attack at tier 1', () => {
    const atk = eligibleFeathers('attack');
    expect(atk.filter(f => f.rarity === 'Orange').length).toBeGreaterThanOrEqual(4);
    expect(atk.filter(f => f.rarity === 'Purple').length).toBeGreaterThanOrEqual(1);
  });
  it('returns ≥4 orange and ≥1 purple for defense at tier 1', () => {
    const def = eligibleFeathers('defense');
    expect(def.filter(f => f.rarity === 'Orange').length).toBeGreaterThanOrEqual(4);
    expect(def.filter(f => f.rarity === 'Purple').length).toBeGreaterThanOrEqual(1);
  });
});

describe('feasibilityPrecheck', () => {
  it('returns true for low tiers with big pool', () => {
    expect(feasibilityPrecheck(1, 1, bigPool)).toBe(true);
  });
  it('returns false when pool is completely empty', () => {
    expect(feasibilityPrecheck(1, 1, emptyPool)).toBe(false);
  });
  it('returns false for very high tiers where min cost exceeds pool', () => {
    // tier 20 costs hundreds per feather; combined 10 statues × 5 feathers will exceed small pool
    expect(feasibilityPrecheck(20, 20, { STDN: 1, LD: 1, DN: 1, ST: 1, Purple: 1 })).toBe(false);
  });
  it('returns true for tier 1 with minimal pool covering cheapest feathers', () => {
    // Cheapest feathers at tier 1 cost 1 unit each from their sets.
    // 10 statues × 5 feathers × 1 unit minimum = 50 total across all sets.
    // With 100 in each set it should pass.
    expect(feasibilityPrecheck(1, 1, { STDN: 100, LD: 100, DN: 100, ST: 100, Purple: 100 })).toBe(true);
  });
});

describe('buildScenarioModel', () => {
  it('produces a model with binary variables for ta=1, td=1', () => {
    const model = buildScenarioModel(1, 1, bigPool, weights, normA, normD);
    expect(model.binaries!.length).toBeGreaterThan(0);
    expect(model.objective.vars.length).toBeGreaterThan(0);
  });
  it('produces fewer variables for ta=10 than ta=1 (tier domain shrinks)', () => {
    const model1 = buildScenarioModel(1, 1, bigPool, weights, normA, normD);
    const model10 = buildScenarioModel(10, 10, bigPool, weights, normA, normD);
    expect(model10.binaries!.length).toBeLessThan(model1.binaries!.length);
  });
  it('produces model name encoding the scenario', () => {
    const model = buildScenarioModel(3, 7, bigPool, weights, normA, normD);
    expect(model.name).toContain('3');
    expect(model.name).toContain('7');
  });
});

describe('scoreCoeff', () => {
  it('returns a positive coefficient for any attack feather at tier 1 with nonzero weights', () => {
    const atk = eligibleFeathers('attack');
    const coef = scoreCoeff(atk[0].id as any, 1, 'attack', 1, weights, normA);
    expect(coef).toBeGreaterThan(0);
  });
  it('returns 0 for a zero-weight stat', () => {
    const zeroWeights = {};
    const atk = eligibleFeathers('attack');
    const coef = scoreCoeff(atk[0].id as any, 1, 'attack', 1, zeroWeights, normA);
    expect(coef).toBe(0);
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run tests/tierEnumModel.test.ts 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module '../src/solver/tierEnumModel'"

- [ ] **Step 1.3: Create `src/solver/tierEnumModel.ts`**

```ts
// src/solver/tierEnumModel.ts
import type { ConversionSet, FeatherId, StatKey, StatueTemplate } from '../domain/types';
import type { TemplateKind } from '../domain/ranking';
import type { GlpkConstraint, GlpkModel } from './glpk';
import { feathers, featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { PCT_CATEGORY_MAP } from '../domain/scoring';
import { BoundType } from './glpk';
import { SETS, totalScore } from './step2';

export const MAX_FEATHER_TIER = 20;

export function eligibleFeathers(kind: TemplateKind) {
  return feathers.filter(f =>
    kind === 'attack'
      ? f.type === 'Attack' || f.type === 'Hybrid'
      : f.type === 'Defense' || f.type === 'Hybrid',
  );
}

export function varName(statueIdx: number, featherId: string, tier: number): string {
  return `y_${statueIdx}_${featherId}_${tier}`;
}

export function scoreCoeff(
  featherId: FeatherId,
  tier: number,
  kind: TemplateKind,
  minTier: number,
  statWeights: Partial<Record<StatKey, number>>,
  normFactors: Partial<Record<StatKey, number>>,
): number {
  const def = featherById.get(featherId)!;
  const tierData = def.tiers[tier];
  if (!tierData) return 0;
  const bonus = kind === 'attack' ? getAttackBonus(minTier) : getDefenseBonus(minTier);
  let coef = 0;
  for (const [statStr, val] of Object.entries(tierData.stats) as [StatKey, number][]) {
    const weight = statWeights[statStr] ?? 0;
    if (weight === 0) continue;
    const norm = normFactors[statStr] ?? 1;
    const pctCat = PCT_CATEGORY_MAP[statStr];
    const pct = pctCat ? (bonus.pct[pctCat] ?? 0) : 0;
    coef += (val / norm) * weight * (1 + pct / 100);
  }
  return coef;
}

/**
 * Conservative feasibility precheck: returns false only when a scenario is
 * provably infeasible without solving any LP/MIP.
 *
 * Checks:
 *   (1) Enough distinct eligible feathers of each rarity at the required minTier.
 *   (2) Total pool across all sets ≥ minimum possible cost for 10 statues.
 *       Minimum cost = 5 × (sum of cheapest 5 attack feathers at ta) +
 *                      5 × (sum of cheapest 5 defense feathers at td).
 *
 * Conservative: never returns false for a genuinely feasible scenario.
 * The LP relaxation prunes the remaining infeasible scenarios.
 */
export function feasibilityPrecheck(
  ta: number,
  td: number,
  poolInitial: Partial<Record<ConversionSet, number>>,
): boolean {
  const atk = eligibleFeathers('attack');
  const def = eligibleFeathers('defense');

  const atkOrange = atk.filter(f => f.rarity === 'Orange' && f.tiers[ta]);
  const atkPurple = atk.filter(f => f.rarity === 'Purple' && f.tiers[ta]);
  const defOrange = def.filter(f => f.rarity === 'Orange' && f.tiers[td]);
  const defPurple = def.filter(f => f.rarity === 'Purple' && f.tiers[td]);

  if (atkOrange.length < 4 || atkPurple.length < 1) return false;
  if (defOrange.length < 4 || defPurple.length < 1) return false;

  const atkFeathers = [...atkOrange, ...atkPurple];
  const defFeathers = [...defOrange, ...defPurple];

  // Sort by totalCost ascending, take 5 cheapest per kind
  const atkCosts = atkFeathers
    .map(f => f.tiers[ta]!.totalCost)
    .sort((a, b) => a - b)
    .slice(0, 5);
  const defCosts = defFeathers
    .map(f => f.tiers[td]!.totalCost)
    .sort((a, b) => a - b)
    .slice(0, 5);

  if (atkCosts.length < 5 || defCosts.length < 5) return false;

  const minTotalCost =
    5 * atkCosts.reduce((s, c) => s + c, 0) +
    5 * defCosts.reduce((s, c) => s + c, 0);

  const totalPool = SETS.reduce((s, set) => s + (poolInitial[set] ?? 0), 0);

  return minTotalCost <= totalPool;
}

export function buildScenarioModel(
  minTierA: number,
  minTierB: number,
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Partial<Record<StatKey, number>>,
  attackNormFactors: Partial<Record<StatKey, number>>,
  defenseNormFactors: Partial<Record<StatKey, number>>,
): GlpkModel {
  const attackEligible = eligibleFeathers('attack');
  const defenseEligible = eligibleFeathers('defense');

  const objVars: { name: string; coef: number }[] = [];
  const binarySet = new Set<string>();
  const constraints: GlpkConstraint[] = [];

  for (let s = 0; s < 10; s++) {
    const kind: TemplateKind = s < 5 ? 'attack' : 'defense';
    const eligible = kind === 'attack' ? attackEligible : defenseEligible;
    const minTier = kind === 'attack' ? minTierA : minTierB;
    const normFactors = kind === 'attack' ? attackNormFactors : defenseNormFactors;

    const statueVarNames: string[] = [];
    const orangeVarNames: string[] = [];
    const purpleVarNames: string[] = [];

    for (const f of eligible) {
      const featherVarNames: string[] = [];

      for (let t = minTier; t <= MAX_FEATHER_TIER; t++) {
        if (!f.tiers[t]) continue;
        const name = varName(s, f.id, t);
        const coef = scoreCoeff(f.id as FeatherId, t, kind, minTier, statWeights, normFactors);
        objVars.push({ name, coef });
        binarySet.add(name);
        statueVarNames.push(name);
        featherVarNames.push(name);
        if (f.rarity === 'Orange') orangeVarNames.push(name);
        else purpleVarNames.push(name);
      }

      if (featherVarNames.length > 0) {
        constraints.push({
          name: `once_s${s}_${f.id}`,
          vars: featherVarNames.map(n => ({ name: n, coef: 1 })),
          bnds: { type: BoundType.UP, lb: 0, ub: 1 },
        });
      }
    }

    if (statueVarNames.length > 0) {
      constraints.push({
        name: `total_s${s}`,
        vars: statueVarNames.map(n => ({ name: n, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 5, ub: 5 },
      });
    }
    if (orangeVarNames.length > 0) {
      constraints.push({
        name: `orange_s${s}`,
        vars: orangeVarNames.map(n => ({ name: n, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 4, ub: 4 },
      });
    }
    if (purpleVarNames.length > 0) {
      constraints.push({
        name: `purple_s${s}`,
        vars: purpleVarNames.map(n => ({ name: n, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 1, ub: 1 },
      });
    }
  }

  for (const convSet of SETS) {
    const budget = poolInitial[convSet] ?? 0;
    const costVars: { name: string; coef: number }[] = [];

    for (let s = 0; s < 10; s++) {
      const kind: TemplateKind = s < 5 ? 'attack' : 'defense';
      const eligible = kind === 'attack' ? attackEligible : defenseEligible;
      const minTier = kind === 'attack' ? minTierA : minTierB;

      for (const f of eligible.filter(ftr => ftr.set === convSet)) {
        for (let t = minTier; t <= MAX_FEATHER_TIER; t++) {
          if (!f.tiers[t]) continue;
          const name = varName(s, f.id, t);
          if (!binarySet.has(name)) continue;
          costVars.push({ name, coef: f.tiers[t]!.totalCost });
        }
      }
    }

    if (costVars.length > 0) {
      constraints.push({
        name: `budget_${convSet}`,
        vars: costVars,
        bnds: { type: BoundType.UP, lb: 0, ub: budget },
      });
    }
  }

  return {
    name: `tierEnum_a${minTierA}_d${minTierB}`,
    objective: { direction: 2, name: 'score', vars: objVars },
    subjectTo: constraints,
    binaries: [...binarySet],
  };
}

export function extractSolution(
  vars: Record<string, number>,
  minTierA: number,
  minTierB: number,
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Partial<Record<StatKey, number>>,
  attackNormFactors: Partial<Record<StatKey, number>>,
  defenseNormFactors: Partial<Record<StatKey, number>>,
): { attack: StatueTemplate[]; defense: StatueTemplate[]; poolRemaining: Partial<Record<ConversionSet, number>>; score: number } {
  const attackEligible = eligibleFeathers('attack');
  const defenseEligible = eligibleFeathers('defense');

  const attack: StatueTemplate[] = Array.from({ length: 5 }, () => ({ feathers: [], minTier: minTierA }));
  const defense: StatueTemplate[] = Array.from({ length: 5 }, () => ({ feathers: [], minTier: minTierB }));
  const costSpent: Partial<Record<ConversionSet, number>> = {};

  for (let s = 0; s < 10; s++) {
    const kind: TemplateKind = s < 5 ? 'attack' : 'defense';
    const eligible = kind === 'attack' ? attackEligible : defenseEligible;
    const minTier = kind === 'attack' ? minTierA : minTierB;
    const template = kind === 'attack' ? attack[s] : defense[s - 5];

    for (const f of eligible) {
      for (let t = minTier; t <= MAX_FEATHER_TIER; t++) {
        if (!f.tiers[t]) continue;
        const name = varName(s, f.id, t);
        if (Math.round(vars[name] ?? 0) === 1) {
          template.feathers.push({ feather: f.id as FeatherId, tier: t });
          costSpent[f.set as ConversionSet] = (costSpent[f.set as ConversionSet] ?? 0) + f.tiers[t]!.totalCost;
        }
      }
    }

    if (template.feathers.length > 0) {
      template.minTier = template.feathers.reduce((m, fi) => Math.min(m, fi.tier), Infinity);
    }
  }

  const poolRemaining: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    poolRemaining[s] = (poolInitial[s] ?? 0) - (costSpent[s] ?? 0);
  }

  const score = totalScore(
    { attack, defense, poolRemaining },
    statWeights,
    attackNormFactors,
    defenseNormFactors,
  );

  return { attack, defense, poolRemaining, score };
}
```

- [ ] **Step 1.4: Update `tierEnum.ts` to import from `tierEnumModel.ts`**

Replace the inline definitions of `eligibleFeathers`, `varName`, `scoreCoeff`, `buildScenarioModel`, `extractSolution` in `src/solver/tierEnum.ts` with imports from `./tierEnumModel`. Remove the `MAX_FEATHER_TIER` const (it moves to `tierEnumModel.ts`).

The resulting `tierEnum.ts` keeps only: the `MAX_ENUM_TIER` const, `TierEnumSolution` type, and `solveTierEnum` function body (unchanged for now). It imports `{ buildScenarioModel, extractSolution, feasibilityPrecheck, MAX_FEATHER_TIER }` from `./tierEnumModel`.

- [ ] **Step 1.5: Run tests**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run tests/tierEnumModel.test.ts 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 1.6: Run full test suite to verify no regressions**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run 2>&1 | tail -30
```

Expected: all existing tests still pass.

- [ ] **Step 1.7: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/solver/tierEnumModel.ts src/solver/tierEnum.ts tests/tierEnumModel.test.ts
git commit -m "refactor: extract tier-enum model helpers into tierEnumModel.ts with feasibility precheck"
```

---

## Task 2: LP relaxation upper bound + scenario sorting

**Files:**
- Modify: `src/solver/tierEnumModel.ts` (add `lpRelaxationUpperBound`)
- Modify: `tests/tierEnumModel.test.ts` (add LP UB tests)

- [ ] **Step 2.1: Add LP UB tests**

Add to `tests/tierEnumModel.test.ts`:

```ts
import { solve } from '../src/solver/glpk';
import { lpRelaxationUpperBound } from '../src/solver/tierEnumModel';

describe('lpRelaxationUpperBound', () => {
  it('returns a number for a feasible scenario', async () => {
    const model = buildScenarioModel(1, 1, bigPool, weights, normA, normD);
    const ub = await lpRelaxationUpperBound(model);
    expect(ub).not.toBeNull();
    expect(typeof ub).toBe('number');
    expect(ub!).toBeGreaterThan(0);
  });

  it('LP bound is ≥ actual MIP solution score for the same model', async () => {
    // Use a small pool so the MIP terminates quickly
    const pool = { STDN: 50, LD: 50, DN: 50, ST: 50, Purple: 50 };
    const model = buildScenarioModel(1, 1, pool, weights, normA, normD);

    const lpUB = await lpRelaxationUpperBound(model);
    const mipResult = await solve(model);
    if (mipResult.result.status !== 5) return; // infeasible, skip

    const mipScore = mipResult.result.z;
    // LP relaxation is an upper bound: must be >= MIP score
    expect(lpUB!).toBeGreaterThanOrEqual(mipScore - 1e-6);
  });
});
```

- [ ] **Step 2.2: Run to confirm failure**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run tests/tierEnumModel.test.ts 2>&1 | tail -15
```

Expected: FAIL — `lpRelaxationUpperBound` not exported.

- [ ] **Step 2.3: Add `lpRelaxationUpperBound` and `sortScenariosByPotential` to `tierEnumModel.ts`**

Add at the end of `src/solver/tierEnumModel.ts`:

```ts
import { solve } from './glpk';

/**
 * Solve the LP relaxation (continuous variables) of a scenario model.
 * Returns the LP optimal value (an upper bound on the MIP), or null if LP is infeasible.
 */
export async function lpRelaxationUpperBound(
  model: GlpkModel,
): Promise<number | null> {
  const relaxed: GlpkModel = { ...model, binaries: [] };
  try {
    const result = await solve(relaxed);
    if (result.result.status !== 5) return null;
    return result.result.z;
  } catch {
    return null;
  }
}

/**
 * Sort scenarios so higher-potential (higher minTier = bigger set-bonus) come first.
 * This lets the incumbent grow quickly and LP-prune more scenarios early.
 * Tie-break: lower total tier (cheaper) first so the incumbent grows from real solutions.
 */
export function sortScenariosByPotential(
  scenarios: { ta: number; td: number }[],
): { ta: number; td: number }[] {
  return [...scenarios].sort((a, b) => {
    const sumB = b.ta + b.td;
    const sumA = a.ta + a.td;
    if (sumB !== sumA) return sumB - sumA; // higher minTier sum first
    return (a.ta + a.td) - (b.ta + b.td);  // tie: prefer lower cost
  });
}
```

Note: the `solve` import creates a circular reference risk since `glpk.ts` is in the same directory. This is fine — TypeScript handles circular imports in the same package correctly; they resolve at runtime.

- [ ] **Step 2.4: Run tests**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run tests/tierEnumModel.test.ts 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 2.5: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/solver/tierEnumModel.ts tests/tierEnumModel.test.ts
git commit -m "feat: add LP relaxation upper bound and scenario sorting to tier-enum model"
```

---

## Task 3: `TierEnumProgress` type + `OptimizeOptions`

**Files:**
- Modify: `src/domain/types.ts`

Short task: add the types used across the call chain.

- [ ] **Step 3.1: Add types to `src/domain/types.ts`**

Append to the end of `src/domain/types.ts`:

```ts
/** Progress reported by the tier-enum optimizer as scenarios are processed. */
export interface TierEnumProgress {
  /** Number of scenarios processed so far (including pruned ones). */
  done: number;
  /** Total scenarios after feasibility precheck pruning. */
  total: number;
  /** Current best score found, or null if no MIP solution has been found yet. */
  bestScore: number | null;
}

/** Options for the top-level optimize() call. Only used by tier-enum mode currently. */
export interface OptimizeOptions {
  /** Called each time a scenario completes (pruned or solved). */
  onProgress?: (p: TierEnumProgress) => void;
  /** When aborted, the optimizer stops and returns the best solution found so far. */
  signal?: AbortSignal;
}
```

- [ ] **Step 3.2: Run tests to confirm no regressions**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 3.3: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/domain/types.ts
git commit -m "feat: add TierEnumProgress and OptimizeOptions types"
```

---

## Task 4: Worker pool (`workerPool.ts`)

**Files:**
- Create: `src/solver/workerPool.ts`
- Create: `tests/workerPool.test.ts`

The pool manages N workers. Each `dispatch(req)` call assigns a `scenarioId`, posts the message to the next idle worker, and returns a Promise that resolves when the worker posts back a response with the same `scenarioId`. `terminate()` terminates all workers.

Because Vitest runs in `node` environment, `Worker` is unavailable. Tests use a manually injected factory to mock workers.

- [ ] **Step 4.1: Write the tests**

```ts
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
```

- [ ] **Step 4.2: Run tests to confirm failure**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run tests/workerPool.test.ts 2>&1 | tail -15
```

Expected: FAIL — `WorkerPool` not found.

- [ ] **Step 4.3: Create `src/solver/workerPool.ts`**

```ts
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

/**
 * A simple fixed-size worker pool.
 *
 * - Spawns `workerCount` workers via the provided factory.
 * - Routes responses back to callers by `scenarioId`.
 * - `dispatch()` assigns the current `scenarioId` from the request (caller's responsibility to set it).
 * - `terminate()` terminates all workers.
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, (resp: ScenarioResponse) => void>();
  // Round-robin index for assigning workers to new tasks
  private nextWorker = 0;

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
      };
      this.workers.push(w);
    }
  }

  dispatch(req: ScenarioRequest): Promise<ScenarioResponse> {
    return new Promise(resolve => {
      this.pending.set(req.scenarioId, resolve);
      const worker = this.workers[this.nextWorker % this.workers.length];
      this.nextWorker++;
      worker.postMessage(req);
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
```

- [ ] **Step 4.4: Run tests**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run tests/workerPool.test.ts 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 4.5: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/solver/workerPool.ts tests/workerPool.test.ts
git commit -m "feat: add WorkerPool for dispatching scenario tasks to Web Workers"
```

---

## Task 5: Worker entry point (`tierEnumWorker.ts`)

**Files:**
- Create: `src/solver/tierEnumWorker.ts`

The worker receives a `ScenarioRequest`, runs feasibilityPrecheck → LP UB → MIP solve (short-circuiting as appropriate), and posts back a `ScenarioResponse`. It imports model helpers and glpk.js directly — Vite bundles these into the worker chunk.

No separate test file: tested via integration in Task 6 + manual browser smoke test. The node test environment cannot run real Worker instances.

- [ ] **Step 5.1: Create `src/solver/tierEnumWorker.ts`**

```ts
// src/solver/tierEnumWorker.ts
// Web Worker entry point for tier-scenario enumeration.
// Vite bundles this as a separate worker chunk via the `new URL(...)` pattern.
import { feasibilityPrecheck, buildScenarioModel, extractSolution, lpRelaxationUpperBound } from './tierEnumModel';
import { solve } from './glpk';
import type { ScenarioRequest, ScenarioResponse } from './workerPool';
import type { ConversionSet } from '../domain/types';
import { SETS } from './step2';

self.onmessage = async (e: MessageEvent<ScenarioRequest>) => {
  const { scenarioId, ta, td, pool, statWeights, attackNormFactors, defenseNormFactors, incumbent } = e.data;

  // (1) Fast feasibility precheck — no solver needed
  if (!feasibilityPrecheck(ta, td, pool)) {
    self.postMessage({ scenarioId, kind: 'feasibility-skip' } satisfies ScenarioResponse);
    return;
  }

  const model = buildScenarioModel(ta, td, pool, statWeights, attackNormFactors, defenseNormFactors);

  // (2) LP relaxation upper bound — skip MIP if LP ≤ incumbent
  const lpUB = await lpRelaxationUpperBound(model);
  if (lpUB === null || lpUB <= incumbent) {
    self.postMessage({ scenarioId, kind: 'lp-skip', lpUB: lpUB ?? -Infinity } satisfies ScenarioResponse);
    return;
  }

  // (3) Full MIP solve
  let mipResult;
  try {
    mipResult = await solve(model);
  } catch (err) {
    self.postMessage({ scenarioId, kind: 'error', message: String(err) } satisfies ScenarioResponse);
    return;
  }

  if (mipResult.result.status !== 5) {
    self.postMessage({ scenarioId, kind: 'mip-infeasible' } satisfies ScenarioResponse);
    return;
  }

  self.postMessage({
    scenarioId,
    kind: 'mip-optimal',
    score: mipResult.result.z,
    vars: mipResult.result.vars,
    ta,
    td,
  } satisfies ScenarioResponse);
};
```

- [ ] **Step 5.2: Verify the file compiles (TypeScript check)**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/solver/tierEnumWorker.ts
git commit -m "feat: add tierEnumWorker entry point for per-scenario MIP dispatch"
```

---

## Task 6: Refactor `solveTierEnum` to use worker pool + pruning

**Files:**
- Modify: `src/solver/tierEnum.ts`
- Modify: `tests/optimize.test.ts` (verify tier-enum mode still works)

This is the core refactor. `solveTierEnum` now:
1. Generates scenarios up to `MAX_ENUM_TIER = 20`.
2. Runs `feasibilityPrecheck` on the main thread to eliminate obviously infeasible scenarios fast.
3. Sorts remaining scenarios by potential.
4. Dispatches to a `WorkerPool` (4 workers). Each worker runs LP → MIP with the current incumbent.
5. Updates incumbent as responses arrive.
6. Fires `onProgress` after each response.
7. Respects `signal.aborted` to stop dispatching and return best-so-far.

- [ ] **Step 6.1: Rewrite `src/solver/tierEnum.ts`**

```ts
// src/solver/tierEnum.ts
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
import { SETS } from './step2';

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
  let best: TierEnumSolution | null = warmStartSolution;

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

  // Dispatch all scenarios concurrently (pool queues internally)
  const requests: Promise<void>[] = scenarios.map((scenario, i) => {
    const req: ScenarioRequest = {
      scenarioId: i,
      ta: scenario.ta,
      td: scenario.td,
      pool: poolInitial,
      statWeights,
      attackNormFactors,
      defenseNormFactors,
      incumbent, // stale is ok — just affects LP cutoff aggressiveness
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
```

Note on the abort flow: when `signal.aborted` fires, we resolve the race and return early with `best` so far. In-flight workers finish their current task (we terminate them after) — in-flight MIP results might be lost but the incumbent is already updated on every completion. This is safe.

There's a subtle issue: `req.incumbent` is captured at dispatch time. Later dispatches will have a stale incumbent if the pool queues them. This is a perf-only concern (LP cutoff is slightly less aggressive), not a correctness concern. To mitigate, worker receives the initial incumbent but also re-checks against what is up to date at execution time... but workers don't have access to the main thread's current incumbent. Trade-off accepted per the spec.

- [ ] **Step 6.2: Check TypeScript compilation**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: no errors.

- [ ] **Step 6.3: Add tier-enum integration test to `tests/optimize.test.ts`**

Open `tests/optimize.test.ts` and add at the end:

```ts
// Add this import at the top of optimize.test.ts:
// import { solveTierEnum } from '../src/solver/tierEnum';
// import type { TierEnumOptions } from '../src/solver/tierEnum';

// And add this describe block at the end of the file:
describe('solveTierEnum (with mock workers)', () => {
  it('returns null when all scenarios are pruned (empty pool)', async () => {
    const { solveTierEnum } = await import('../src/solver/tierEnum');
    const weights = weightsFromRanking(DEFAULT_RANKING);
    const normA = computeNormFactors(feathers, 'attack');
    const normD = computeNormFactors(feathers, 'defense');

    const result = await solveTierEnum(
      { STDN: 0, LD: 0, DN: 0, ST: 0, Purple: 0 },
      weights, normA, normD,
      {},
      // Mock worker factory — should not be called since feasibility pruning removes all
      () => { throw new Error('Worker should not be spawned'); },
    );
    expect(result).toBeNull();
  });
});
```

Note: This test passes `() => { throw ... }` as `workerFactory`. If the precheck correctly prunes all scenarios with empty pool, the worker is never spawned and the test passes. If pruning fails, the worker factory throws and the test catches that.

- [ ] **Step 6.4: Run tests**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass including the new integration test.

- [ ] **Step 6.5: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/solver/tierEnum.ts tests/optimize.test.ts
git commit -m "feat: refactor solveTierEnum to use WorkerPool with feasibility pruning and LP incumbent cutoff"
```

---

## Task 7: Wire `optimize.ts` — warm start, progress, polish pass

**Files:**
- Modify: `src/solver/optimize.ts`

Three changes to `runTierEnum`:
1. Run greedy two-step first to seed `incumbentScore` and get a fallback solution.
2. Pass `incumbentScore`, `onProgress`, `signal` to `solveTierEnum`.
3. After `solveTierEnum` returns, run `iterateUpgrades` on the winner (the polish pass).

Also update `optimize()` signature to accept `OptimizeOptions`.

- [ ] **Step 7.1: Update `src/solver/optimize.ts`**

Change the function signature and `runTierEnum` function:

```ts
// In optimize.ts, change the optimize() signature:
export async function optimize(
  inventory: Inventory,
  ranking: StatRanking,
  mode: OptimizerMode = 'greedy',
  options: OptimizeOptions = {},
): Promise<OptimizeResult>

// Add the import at the top:
import type { OptimizeOptions } from '../domain/types';
```

Replace the `runTierEnum` function body (currently lines 134-162):

```ts
async function runTierEnum(
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Parameters<typeof solveTierEnum>[1],
  attackNormFactors: Parameters<typeof solveTierEnum>[2],
  defenseNormFactors: Parameters<typeof solveTierEnum>[3],
  options: OptimizeOptions,
): Promise<OptimizeResult> {
  // Step A: greedy two-step warm-start for a strong incumbent + fallback
  const step1 = await solveT1Setup(poolInitial, statWeights, attackNormFactors, defenseNormFactors);
  let warmStartSolution: import('./tierEnum').TierEnumSolution | undefined;
  let incumbentScore = -Infinity;

  if (step1) {
    const warmState = iterateUpgrades(
      { attack: step1.attack, defense: step1.defense, poolRemaining: step1.poolRemaining },
      statWeights, attackNormFactors, defenseNormFactors,
    );
    incumbentScore = totalScore(warmState, statWeights, attackNormFactors, defenseNormFactors);
    warmStartSolution = {
      attack: warmState.attack,
      defense: warmState.defense,
      poolRemaining: warmState.poolRemaining,
      score: incumbentScore,
    };
  }

  // Step B: tier-scenario enumeration with warm-start incumbent
  const tierEnumSol = await solveTierEnum(
    poolInitial, statWeights, attackNormFactors, defenseNormFactors,
    {
      incumbentScore,
      warmStartSolution,
      onProgress: options.onProgress,
      signal: options.signal,
    },
  );

  // Fall back to warm-start if tier-enum found nothing better (or was aborted early)
  const rawSol = tierEnumSol ?? warmStartSolution;
  if (!rawSol) {
    return {
      ok: false,
      reason: 'infeasible',
      message: 'Tier-scenario enumeration found no feasible solution across all enumerated scenarios.',
    };
  }

  // Step C: polish pass — iterateUpgrades can lift individual statue minTiers
  // (recovering heterogeneous minTier configurations tier-enum can't represent).
  const polishedState = iterateUpgrades(
    { attack: rawSol.attack, defense: rawSol.defense, poolRemaining: rawSol.poolRemaining },
    statWeights, attackNormFactors, defenseNormFactors,
  );

  const spentPerSet: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    spentPerSet[s] = (poolInitial[s] ?? 0) - (polishedState.poolRemaining[s] ?? 0);
  }

  return {
    ok: true,
    solution: {
      attack: polishedState.attack,
      defense: polishedState.defense,
      spentPerSet,
      totalPerSet: poolInitial,
      score: totalScore(polishedState, statWeights, attackNormFactors, defenseNormFactors),
    },
  };
}
```

Also thread `options` into the `optimize()` call to `runTierEnum`:

```ts
if (mode === 'tier-enum') {
  return runTierEnum(poolInitial, statWeights, attackNormFactors, defenseNormFactors, options);
}
```

- [ ] **Step 7.2: Check TypeScript compilation**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: no errors.

- [ ] **Step 7.3: Run tests**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 7.4: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/solver/optimize.ts
git commit -m "feat: add greedy warm-start and iterateUpgrades polish pass to tier-enum optimizer"
```

---

## Task 8: `App.tsx` — progress state, abort controller, cancel handler

**Files:**
- Modify: `src/App.tsx`

Three additions:
1. `progress: TierEnumProgress | null` state — reset to null on each run, updated via `onProgress`.
2. `abortControllerRef` — persists across renders so `handleCancel` can abort the in-flight run.
3. Pass `onProgress`, `signal`, and `onCancel` down to `StatRankerControls`.

- [ ] **Step 8.1: Update `src/App.tsx`**

At the top, add to imports:
```ts
import type { Inventory, Solution, Failure, OptimizerMode, TierEnumProgress } from './domain/types';
import type { OptimizeOptions } from './domain/types';
```

After `const [loading, setLoading] = useState(false);` (line 29), add:
```ts
const [progress, setProgress] = useState<TierEnumProgress | null>(null);
const abortControllerRef = useRef<AbortController | null>(null);
```

Replace `runOptimize` with (same logic, adds progress + abort):
```ts
const runOptimize = useCallback(async (inv: Inventory, r: StatRanking, m: OptimizerMode) => {
  // Abort any in-flight run
  abortControllerRef.current?.abort();
  const controller = new AbortController();
  abortControllerRef.current = controller;

  setLoading(true);
  setProgress(null);
  setFailure(null);
  setSolution(null);
  try {
    const opts: OptimizeOptions = {
      signal: controller.signal,
      onProgress: m === 'tier-enum' ? setProgress : undefined,
    };
    const result = await optimize(inv, r, m, opts);
    if (controller.signal.aborted) return; // ignore results if cancelled
    if (result.ok) {
      setSolution(result.solution);
      setFailure(null);
    } else if (result.reason === 'inventory') {
      setFailure({ kind: 'inventory', diagnostics: result.diagnostics });
    } else {
      setFailure({ kind: 'generic', message: result.message ?? 'No feasible solution found.' });
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      setFailure({ kind: 'generic', message: String(e) });
    }
  } finally {
    setLoading(false);
    setProgress(null);
    abortControllerRef.current = null;
  }
}, []);
```

Add the cancel handler after `runOptimize`:
```ts
const handleCancel = useCallback(() => {
  abortControllerRef.current?.abort();
}, []);
```

Abort on unmount (add to existing `useEffect` or as a new one near the top):
```ts
useEffect(() => {
  return () => { abortControllerRef.current?.abort(); };
}, []);
```

Pass the new props to `StatRankerControls` in the JSX (replace the existing `<StatRankerControls .../>` block):
```tsx
<StatRankerControls
  ranking={ranking}
  onChange={setRanking}
  onOptimize={handleOptimize}
  loading={loading}
  mode={mode}
  onModeChange={setMode}
  progress={progress}
  onCancel={mode === 'tier-enum' ? handleCancel : undefined}
/>
```

- [ ] **Step 8.2: Check TypeScript compilation**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: TypeScript errors on `StatRankerControls` for new props (we haven't added them yet). That's fine — fix in Task 9.

- [ ] **Step 8.3: Commit (WIP, known TS error)**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/App.tsx
git commit -m "feat: add progress state and abort controller to App.tsx for tier-enum cancel support"
```

---

## Task 9: Progress bar + Cancel button in `StatRankerControls.tsx`

**Files:**
- Modify: `src/ui/StatRankerControls.tsx`

Add `progress` and `onCancel` props. Render:
- A native `<progress>` element below the mode selector when `loading && progress`.
- A "Cancel" button when `onCancel` is defined and `loading`.

- [ ] **Step 9.1: Update the `Props` interface in `StatRankerControls.tsx`**

Open `src/ui/StatRankerControls.tsx`. In the `interface Props` block, add after `loading: boolean;`:

```ts
progress?: import('../domain/types').TierEnumProgress | null;
onCancel?: () => void;
```

- [ ] **Step 9.2: Update the function signature**

In the `export function StatRankerControls(...)` declaration, add `progress, onCancel` to the destructured props:

```ts
export function StatRankerControls({ ranking, onChange, onOptimize, loading, mode, onModeChange, progress, onCancel }: Props) {
```

- [ ] **Step 9.3: Add the progress bar and Cancel button**

Locate the existing Optimize button (line ~715):
```tsx
<button className="primary" onClick={onOptimize} disabled={loading}>
  {loading ? 'Optimizing…' : 'Optimize'}
</button>
```

Replace with:

```tsx
{loading && progress && (
  <div style={{ marginBottom: 8 }}>
    <progress
      value={progress.done}
      max={progress.total}
      style={{ width: '100%', accentColor: 'var(--accent)', height: 6 }}
    />
    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textAlign: 'center' }}>
      {progress.done} / {progress.total} scenarios
      {progress.bestScore !== null
        ? ` · best so far ${progress.bestScore.toFixed(2)}`
        : ''}
    </div>
  </div>
)}

<div style={{ display: 'flex', gap: 8 }}>
  <button
    className="primary"
    onClick={onOptimize}
    disabled={loading}
    style={{ flex: 1 }}
  >
    {loading ? 'Optimizing…' : 'Optimize'}
  </button>
  {onCancel && loading && (
    <button
      onClick={onCancel}
      style={{
        padding: '0 14px',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'inherit',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        cursor: 'pointer',
        color: 'var(--muted)',
      }}
    >
      Cancel
    </button>
  )}
</div>
```

- [ ] **Step 9.4: Check TypeScript compilation**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: no errors.

- [ ] **Step 9.5: Run full test suite**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 9.6: Commit**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add src/ui/StatRankerControls.tsx
git commit -m "feat: add progress bar and Cancel button to StatRankerControls for tier-enum mode"
```

---

## Task 10: Worker bundling smoke test + manual UX verification

**Files:** none new

Validate that Vite bundles `tierEnumWorker.ts` correctly and the progress bar renders.

- [ ] **Step 10.1: Start the dev server and open the app**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npm run dev
```

Open `http://localhost:5173/odins-workshop/` (or whatever port Vite chooses).

- [ ] **Step 10.2: Test greedy mode is unaffected**

Select "Greedy" mode, enter any inventory, click Optimize. Verify: no progress bar shown, result appears within seconds.

- [ ] **Step 10.3: Test tier-enum progress bar**

Select "Tier Enumeration" mode, enter a realistic inventory, click Optimize. Verify:
- Progress bar appears immediately with `0 / N scenarios`.
- Bar advances as scenarios complete.
- Score counter updates (e.g., `best so far 3,142.50`).
- Cancel button is visible next to Optimize.
- Result appears at the end and is ≥ the greedy result for the same inventory.

- [ ] **Step 10.4: Test Cancel mid-run**

Click Optimize in tier-enum mode, then immediately click Cancel. Verify:
- `loading` drops to false within ~1s.
- A solution is still shown (the warm-start greedy solution or whatever was found before cancel).
- No console errors.

- [ ] **Step 10.5: Test that worker loads without errors**

Open browser DevTools → Network tab → filter "worker". Confirm a worker bundle request appears when the first tier-enum run starts. Confirm no 404 or CSP errors.

- [ ] **Step 10.6: Verify worker bundling in production build**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer && npm run build 2>&1 | tail -30
```

Expected: build succeeds. In the `dist/` output, confirm a `*-worker-*.js` chunk exists.

- [ ] **Step 10.7: Final commit (if any lingering fixes)**

```bash
cd /home/richard/srcs/projects/rooc-feather-optimizer
git add -p   # stage any fixes from smoke test
git commit -m "fix: address any worker bundling issues found during smoke test"
```

---

## Troubleshooting: Vite worker bundling with glpk.js

If `npm run build` fails or the worker 404s in dev:

**Symptom:** `Error: Cannot use import statement in a worker` or similar.

**Cause:** `glpk.js` ships a CJS build that Vite can't bundle into a module worker.

**Fix:** In `src/solver/tierEnumWorker.ts`, replace `import GLPK from 'glpk.js'` (if you had a direct import) with the dynamic version. The actual GLPK import is in `glpk.ts`, which uses `import GLPK from 'glpk.js'`. If this fails in a worker context, add this to `vite.config.ts`:

```ts
worker: {
  format: 'iife',  // fallback from 'es' if glpk.js CJS causes issues
},
```

Or mark glpk.js as external in the worker and serve it from CDN. Check the existing `optimizeDeps.exclude: ['glpk.js']` in `vite.config.ts` — this exclusion applies to the main bundle but workers have their own optimizeDeps context.

If worker bundling proves intractable, fall back to the sequential implementation in `solveTierEnum` (remove the `WorkerPool` and restore the `for ta…for td` loop) but keep all the pruning logic. Sequential with pruning is already a major improvement over the baseline.
