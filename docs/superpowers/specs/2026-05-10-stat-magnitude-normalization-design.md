# Stat Magnitude Normalization Design

**Date:** 2026-05-10  
**Status:** Approved

## Problem

The optimizer's objective function computes score as `Σ stat_value × fibonacci_weight × (1 + pct_bonus)` using raw stat values. Feather stats have severe magnitude disparities — HP peaks at 210 per feather at tier 20 while INTDEXSTR peaks at 7, a 30× difference. The Fibonacci weighting system (which tops out at 13–21) cannot bridge this gap, so high-magnitude stats dominate the optimizer's decisions regardless of the user's expressed priorities.

## Goal

When a user ranks two stats equally, those stats should exert equal pull on the optimizer's feather selection decisions. Normalization should make the Fibonacci weights faithfully represent user intent.

## Normalization Strategy

**Method:** Divide each stat's LP coefficient by the maximum tier-20 value that stat reaches on any single feather in the pool for that statue type (pool-specific max normalization). The normalization factor for a stat is `max(tier20_value[f][stat])` over all compatible feathers `f`.

**Reference point:** Tier 20 maximum per stat, scoped to the feather pool for the statue type:
- Attack statues: Attack + Hybrid feathers
- Defense statues: Defense + Hybrid feathers

**Fallback:** Stats with no feather providing them in a pool (all-zero column) use a normalization factor of `1` — a no-op that avoids division by zero.

**Percentage bonuses:** Applied after normalization — `(val / norm) × weight × (1 + pct / 100)` — so set bonuses continue to scale proportionally.

## Architecture

### New: `src/solver/normFactors.ts`

Exports a single pure function:

```ts
computeNormFactors(
  feathers: FeatherRecord[],
  statueType: 'attack' | 'defense'
): Partial<Record<StatKey, number>>
```

Filters the feather pool to those compatible with `statueType`, then returns a lookup table mapping each stat key to its maximum tier-20 value across that pool. Stats absent from the pool map to `1`.

### Modified: `src/solver/buildModel.ts`

Gains one new parameter `normFactors: Partial<Record<StatKey, number>>`. Coefficient computation changes from:

```ts
coef += val * weight * (1 + pct / 100);
```

to:

```ts
const norm = normFactors[statStr] ?? 1;
coef += (val / norm) * weight * (1 + pct / 100);
```

All other LP structure, constraints, and the two-phase approach are unchanged.

### Modified: call site in `src/solver/`

`computeNormFactors` is called once per statue type before the LP is built and the result is passed into `buildModel`. With only two statue types, at most two normalization tables are computed per solve and reused across all statues of the same type.

```ts
const normFactors = computeNormFactors(feathers, statueType);
const model = buildModel({ ...params, normFactors });
```

## Testing

### `src/solver/normFactors.test.ts` (new)

- Given a fixture feather pool with known tier-20 values, assert the returned table matches expected maxes per stat
- Assert Attack pool excludes pure Defense feathers; Defense pool excludes pure Attack feathers; Hybrid feathers appear in both pools
- Assert all-zero stats return `1` as the fallback normalization factor

### `src/solver/buildModel.test.ts` (extend)

- Given two feathers with equal user weight but 30× magnitude difference (e.g., HP and INTDEXSTR), assert that the LP objective coefficients for each are approximately equal after normalization

## Out of Scope

- User-facing toggle to disable normalization
- Normalization baked into generated data files
- Per-tier normalization (C-style marginal-gain approach)
- Game-mechanical normalization by character base stats (B-style)
