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

import type { ConversionSet, FeatherId, Inventory, InventoryDiagnostic } from '../domain/types';
import type { StatRanking, TemplateKind } from '../domain/ranking';
import { weightsFromRanking } from '../domain/ranking';
import { feathers } from '../data/feathers.generated';
import { solveT1Setup } from './step1';
import { iterateUpgrades, totalScore, SETS } from './step2';
import { computeNormFactors } from './normFactors';

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
): Promise<OptimizeResult> {
  const inventoryDiagnostics = checkInventory(inventory);
  if (inventoryDiagnostics.length > 0) {
    return { ok: false, reason: 'inventory', diagnostics: inventoryDiagnostics };
  }

  const statWeights = weightsFromRanking(ranking);
  const poolInitial = poolBudgets(inventory);

  const attackNormFactors = computeNormFactors(feathers, 'attack');
  const defenseNormFactors = computeNormFactors(feathers, 'defense');

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
