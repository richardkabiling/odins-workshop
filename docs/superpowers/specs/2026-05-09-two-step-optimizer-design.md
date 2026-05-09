# Two-Step Optimizer Redesign

## Context

The current optimizer (`src/solver/optimize.ts:238`) uses a 3-phase hybrid: a Phase-1 joint-feasibility ILP, a per-budget-fraction precompute that runs 20 single-statue ILPs per kind (`precomputePerBudgetFraction`, `optimize.ts:84-137`), and a greedy gradient walk over those precomputed curves (`greedyAllocate`, `optimize.ts:147-236`). This has two weaknesses worth fixing:

- **Set-bonus pct is never optimized.** Every `buildModel` call uses `minTier=1`, so the ILP scores feathers using tier-1 set-bonus pct even when the realized statue ends up at a higher min-tier (`buildModel.ts:39-141`).
- **Cross-statue allocation is approximated by gradient walk** rather than an explicit upgrade decision, making it hard to reason about why a particular tier was chosen.

We are replacing this with a simpler, easier-to-reason-about two-step algorithm:

1. Pick the best 50-feather setup at all-T1 (a single small ILP).
2. Repeatedly apply the single best per-set-pool-fraction upgrade until no upgrade is feasible.

The output `Solution` shape (`src/domain/types.ts:59-67`) and the UI (`ResultsView.tsx`, `StatRankerControls.tsx`) are unchanged.

## Approach

### Step 1 — T1 base solve (joint ILP, one solve)

At T1 every statue of the same kind shares the same set bonus, so the score contribution of a feather is independent of which of the 5 statues holds it. The decision reduces to *how many copies of each feather appear in attack vs. defense statues*.

ILP variables:
- `xA[f] ∈ {0..5}` for every attack-eligible feather (`type ∈ {Attack, Hybrid}`)
- `xD[f] ∈ {0..5}` for every defense-eligible feather (`type ∈ {Defense, Hybrid}`)

Constraints:
- `Σ_{f orange} xA[f] = 20`, `Σ_{f purple} xA[f] = 5`
- `Σ_{f orange} xD[f] = 20`, `Σ_{f purple} xD[f] = 5`
- For each conversion set `s`: `Σ_{f ∈ s} (xA[f] + xD[f]) ≤ pool_initial[s]`

Objective:
```
maximize Σ_f weight_score(f, T1_attack_pct) · xA[f]
       + Σ_f weight_score(f, T1_defense_pct) · xD[f]

weight_score(f, pct) = Σ_stat weight[stat] · stat_T1[f] · (1 + pct/100)
```
Flat bonuses are constant at this stage and drop out of the objective (they are added back when the final `Solution.score` is computed via `computeStatueStats`, `scoring.ts:45-75`).

Post-solve, distribute feathers into 5 statues per kind by round-robin: list each `(feather, copy_index)` pair and assign sequentially across statues. Per-statue uniqueness holds because every feather has `x[f] ≤ 5`. Each statue ends up with exactly 4 orange + 1 purple by construction.

After Step 1: `pool_remaining[s] = pool_initial[s] − Σ_{f ∈ s} (xA[f] + xD[f])`.

### Step 2 — iterative upgrade greedy

State: 10 `StatueTemplate`s with current per-feather tiers + `pool_remaining[set]`.

**Move types** considered every iteration:
- **(A) Single-feather upgrade.** Pick a slot at tier `t < 20`, raise to `t+1`. Δcost on the feather's set = `feather.tiers[t].costToNext`.
- **(B) Lift statue min-tier.** For a statue at min-tier `m < 20`, upgrade *every* feather currently at tier `m` to `m+1`. May span multiple sets (e.g. 4 orange in STDN + 1 purple); Δcost is summed per-set.

Both moves affect exactly one statue, so `Δscore = weighted_score(affected_statue, after) − weighted_score(affected_statue, before)`, computed by recomputing `computeStatueStats` (`scoring.ts:45-75`) over just that statue and summing `Σ_stat weight[stat] · stat_value`. Δscore naturally captures any pct/flat set-bonus jump triggered by the move.

**Feasibility:** for every set `s` the move touches, `Δcost[s] ≤ pool_remaining[s]`.

**Efficiency metric (Δscore / fractional pool consumption):**
```
fractional_pressure = Σ_{s touched} (Δcost[s] / pool_remaining[s])
efficiency = Δscore / fractional_pressure
```
Single-set moves collapse to `Δscore × pool_remaining / Δcost`. Multi-set lifts sum the per-set fractional pressures.

**Iteration:**
```
while True:
    candidates = all feasible moves (≤50 single + ≤10 lift)
    if empty: break
    best = argmax(efficiency, tie-break by higher Δscore)
    if best.Δscore ≤ 0: break    # safety
    apply best to state
```

**Stop conditions:** all 50 feathers at T20, or no move's Δcost fits within the remaining pools.

## Files

**New:**
- `src/solver/step1.ts` — `solveT1Setup(inventory, ranking) → { attack: StatueTemplate[5], defense: StatueTemplate[5], poolRemaining: Record<ConversionSet, number> }`. Builds and solves the joint T1 ILP via GLPK; performs the round-robin distribution.
- `src/solver/step2.ts` — `iterateUpgrades(state, ranking) → state'`. Pure TS; no GLPK. Enumerates the ≤60 candidate moves, evaluates Δscore via `computeStatueStats`, picks the argmax, applies, repeats.

**Modified:**
- `src/solver/optimize.ts` — replace body of `optimize()` (line 238). New body: `checkInventory()` (keep `optimize.ts:43-63`) → `solveT1Setup()` → `iterateUpgrades()` → assemble `Solution` with `spentPerSet`/`totalPerSet` derived from `pool_initial − pool_remaining`. Delete `precomputePerBudgetFraction` (`optimize.ts:84-137`) and `greedyAllocate` (`optimize.ts:147-236`).

**Deleted:**
- `src/solver/buildModel.ts` — `buildPhase1Model` and `buildModel` are no longer referenced. Delete the file (or trim to anything still needed by `step1.ts`).

**Reused:**
- `checkInventory` (`src/solver/optimize.ts:43-63`)
- `poolBudgets` (`src/solver/optimize.ts:28-35`)
- `computeStatueStats` (`src/domain/scoring.ts:45-75`)
- `flatBonusScore` (`src/solver/optimize.ts:289-302`) for the final score assembly
- `getAttackBonus` / `getDefenseBonus` (`src/data/setBonuses.generated.ts`)
- `weightsFromRanking` (`src/domain/ranking.ts:37-54`) — already invoked upstream of `optimize()`; no change

## Acknowledged tradeoffs

- **T1 commitment.** Feather selection happens at T1; a feather that scales unusually well at high tiers but is mediocre at T1 will not be picked. Matches the user-specified two-step structure.
- **Greedy isn't globally optimal.** No lookahead beyond a single move (single-feather or lift). Same class of limitation as the current gradient walk; in exchange we get a much simpler algorithm.

## Verification

**Unit tests:**

`tests/step1.test.ts` (new):
- Generous inventory, balanced weights → all 5 attack statues identical, all 5 defense statues identical.
- Tight inventory (e.g. `{ Space: 10, Time: 10 }` only) → ILP respects per-set pool cap; no infeasibility.
- Hybrid feather (e.g. Light/Dark) splits between attack and defense kinds when both kinds value it.
- Orange/purple slot counts always exactly 20/5 per kind.

`tests/step2.test.ts` (new):
- Infinite pool → terminates with all feathers at T20.
- Pool sized to fund exactly one tier-up of one feather → algorithm picks the best-efficiency single move and stops on the next iteration.
- Lift-only scenario: pool can't afford any single high-cost upgrade but can afford a cheap lift; lift fires.
- Multi-set lift: respects per-set feasibility independently (one set is fine, another is depleted → lift not feasible).
- Tie-break: when two moves tie on efficiency, the higher-Δscore one is selected.

`tests/optimize.test.ts` (extend):
- End-to-end on a realistic inventory & ranking (reuse fixtures already present).
- Assert `Solution.score === sum of computeStatueStats over all statues weighted by ranking weights`.
- Assert `spentPerSet[s] + pool_remaining[s] === pool_initial[s]` for each set.

**Manual sanity check after implementation:**
- `npm run dev`; in the browser, run the optimizer with the existing 'Balanced' preset and a representative inventory. Compare the produced statues against expectations (Hybrid feathers should appear where they help most; high-weight stats should drive feather selection at T1; total score should not regress meaningfully on balanced inputs).
- `npm run build` and `npm run test` both green.
