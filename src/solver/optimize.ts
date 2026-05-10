/**
 * Public optimizer entry point — two-step algorithm.
 *
 * Step 1 (step1.ts): Joint ILP at tier 1 selects which feathers fill the
 *   5 attack and 5 defense statues, maximising weighted score under per-set
 *   pool budgets. All feathers start at tier 1.
 *
 * Step 2 (step2.ts): Iterative greedy upgrade loop. Each iteration picks the
 *   feasible single-feather or lift move with the highest efficiency
 *   (Δscore / fractional pool pressure) until no improvement remains.
 *
 * The output Solution shape and the UI are unchanged.
 */

import type { ConversionSet, FeatherId, Inventory, InventoryDiagnostic, OptimizerMode, OptimizeOptions } from '../domain/types';
import type { StatRanking, TemplateKind } from '../domain/ranking';
import { weightsFromRanking } from '../domain/ranking';
import { feathers } from '../data/feathers.generated';
import { solveT1Setup } from './step1';
import { iterateUpgrades, totalScore, SETS } from './step2';
import { computeNormFactors } from './normFactors';
import { solveTierEnum } from './tierEnum';
import { solveJointMip } from './jointMip';

export type OptimizeResult =
  | { ok: true; solution: import('../domain/types').Solution }
  | { ok: false; reason: 'infeasible' | 'error'; message?: string }
  | { ok: false; reason: 'inventory'; diagnostics: InventoryDiagnostic[] };

function poolBudgets(inventory: Inventory): Partial<Record<ConversionSet, number>> {
  const budgets: Partial<Record<ConversionSet, number>> = {};
  for (const featherDef of feathers) {
    const count = inventory.perFeather[featherDef.id as FeatherId] ?? 0;
    budgets[featherDef.set] = (budgets[featherDef.set] ?? 0) + count;
  }
  return budgets;
}

/**
 * Check inventory has ≥4 distinct orange + ≥1 distinct purple eligible
 * feathers accessible for each statue kind.  A feather is "accessible" if
 * the user has any feathers in its conversion set.
 * Returns diagnostics for failed constraints, or [] if all ok.
 */
function checkInventory(inventory: Inventory): InventoryDiagnostic[] {
  const budgetBySet = poolBudgets(inventory);
  const diagnostics: InventoryDiagnostic[] = [];
  for (const kind of ['attack', 'defense'] as TemplateKind[]) {
    for (const [rarity, need] of [['Orange', 4], ['Purple', 1]] as ['Orange' | 'Purple', number][]) {
      const eligible = feathers.filter(f =>
        (kind === 'attack'
          ? f.type === 'Attack' || f.type === 'Hybrid'
          : f.type === 'Defense' || f.type === 'Hybrid')
        && f.rarity === rarity,
      );
      const accessible = eligible.filter(f => (budgetBySet[f.set] ?? 0) > 0);
      if (accessible.length < need) {
        const missing = eligible
          .filter(f => !(budgetBySet[f.set] ?? 0))
          .map(f => f.id as FeatherId);
        diagnostics.push({ kind, rarity, need, have: accessible.length, missing });
      }
    }
  }
  return diagnostics;
}

export async function optimize(
  inventory: Inventory,
  ranking: StatRanking,
  mode: OptimizerMode = 'greedy',
  options: OptimizeOptions = {},
): Promise<OptimizeResult> {
  const inventoryDiagnostics = checkInventory(inventory);
  if (inventoryDiagnostics.length > 0) {
    return { ok: false, reason: 'inventory', diagnostics: inventoryDiagnostics };
  }

  const statWeights = weightsFromRanking(ranking);
  const poolInitial = poolBudgets(inventory);

  const attackNormFactors = computeNormFactors(feathers, 'attack');
  const defenseNormFactors = computeNormFactors(feathers, 'defense');

  if (mode === 'tier-enum') {
    return runTierEnum(poolInitial, statWeights, attackNormFactors, defenseNormFactors, options);
  }

  if (mode === 'joint-mip') {
    return runJointMip(poolInitial, statWeights, attackNormFactors, defenseNormFactors);
  }

  // Default: greedy two-step

  // Step 1 — joint T1 ILP
  const step1 = await solveT1Setup(poolInitial, statWeights, attackNormFactors, defenseNormFactors);
  if (!step1) {
    return {
      ok: false,
      reason: 'infeasible',
      message:
        'Could not find a feasible T1 setup. Check that your inventory has ' +
        'enough feathers to fill all 10 statues simultaneously.',
    };
  }

  // Step 2 — iterative upgrade greedy
  const finalState = iterateUpgrades(
    { attack: step1.attack, defense: step1.defense, poolRemaining: step1.poolRemaining },
    statWeights,
    attackNormFactors,
    defenseNormFactors,
  );

  const score = totalScore(finalState, statWeights, attackNormFactors, defenseNormFactors);

  // spentPerSet = poolInitial − poolRemaining
  const spentPerSet: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    spentPerSet[s] = (poolInitial[s] ?? 0) - (finalState.poolRemaining[s] ?? 0);
  }

  return {
    ok: true,
    solution: {
      attack: finalState.attack,
      defense: finalState.defense,
      spentPerSet,
      totalPerSet: poolInitial,
      score,
    },
  };
}

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

async function runJointMip(
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Parameters<typeof solveJointMip>[1],
  attackNormFactors: Parameters<typeof solveJointMip>[2],
  defenseNormFactors: Parameters<typeof solveJointMip>[3],
): Promise<OptimizeResult> {
  const sol = await solveJointMip(poolInitial, statWeights, attackNormFactors, defenseNormFactors);
  if (!sol) {
    return {
      ok: false,
      reason: 'infeasible',
      message: 'Joint MIP solver reported infeasibility or timed out. Try a different optimizer.',
    };
  }
  const spentPerSet: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    spentPerSet[s] = (poolInitial[s] ?? 0) - (sol.poolRemaining[s] ?? 0);
  }
  return {
    ok: true,
    solution: {
      attack: sol.attack,
      defense: sol.defense,
      spentPerSet,
      totalPerSet: poolInitial,
      score: sol.score,
    },
  };
}
