/**
 * Public optimizer entry point.
 *
 * Algorithm:
 *  1. Pre-check inventory: ≥4 orange + ≥1 purple eligible feathers per statue kind.
 *  2. Pool per-feather inventory into per-conversion-set budgets.
 *  3. Phase 1: joint ILP at tier=1 checks global feasibility (can 10 statues fit the budget?).
 *  4. Phase 2: For each template kind, precompute best single-statue solution per minTier (1..20)
 *     using full pool budget as a permissive upper bound.
 *  5. Greedy upgrade: start all statues at lowest feasible tier, repeatedly upgrade the statue
 *     whose tier-bump gives the largest score gain that fits the shared pool.
 */

import type { ConversionSet, FeatherId, Inventory, InventoryDiagnostic, Solution, StatueTemplate, StatKey } from '../domain/types';
import type { TemplateKind, StatRanking } from '../domain/ranking';
import { weightsFromRanking } from '../domain/ranking';
import { feathers, featherById } from '../data/feathers.generated';
import { buildModel, buildPhase1Model, flatBonusScore } from './buildModel';
import { solve } from './glpk';

export type OptimizeResult =
  | { ok: true; solution: Solution }
  | { ok: false; reason: 'infeasible' | 'error'; message?: string }
  | { ok: false; reason: 'inventory'; diagnostics: InventoryDiagnostic[] };

const SETS: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];

function poolBudgets(inventory: Inventory): Partial<Record<ConversionSet, number>> {
  const budgets: Partial<Record<ConversionSet, number>> = {};
  for (const featherDef of feathers) {
    const count = inventory.perFeather[featherDef.id as FeatherId] ?? 0;
    budgets[featherDef.set] = (budgets[featherDef.set] ?? 0) + count;
  }
  return budgets;
}

/**
 * Check inventory has ≥4 distinct orange + ≥1 distinct purple eligible feathers
 * accessible for each statue kind. A feather is "accessible" if the user has any
 * feathers in its conversion set (since feathers within the same set can be freely
 * converted to one another). Returns diagnostics for failed constraints, or [] if all ok.
 */
function checkInventory(inventory: Inventory): InventoryDiagnostic[] {
  const budgetBySet = poolBudgets(inventory);
  const diagnostics: InventoryDiagnostic[] = [];
  for (const kind of ['attack', 'defense'] as TemplateKind[]) {
    for (const [rarity, need] of [['Orange', 4], ['Purple', 1]] as ['Orange'|'Purple', number][]) {
      const eligible = feathers.filter(f =>
        (kind === 'attack' ? f.type === 'Attack' || f.type === 'Hybrid' : f.type === 'Defense' || f.type === 'Hybrid')
        && f.rarity === rarity,
      );
      // A feather is accessible if the user has any feathers in its conversion set
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

interface SingleStatueSolution {
  template: StatueTemplate;
  score: number;                                    // weighted score for this statue
  costPerSet: Partial<Record<ConversionSet, number>>;
}

/**
 * Precompute single-statue solutions across a range of budget caps.
 *
 * Iterates budget fractions (1/20 … 20/20 of totalBudgets) and for each
 * cap solves a single-statue ILP (minTier=1, maximise score within the cap).
 * This produces a gradient from cheapest→most-expensive solutions so that
 * greedyAllocate can start all 10 statues at a low budget fraction (which
 * fits within the shared pool) and then upgrade incrementally.
 *
 * Previously the loop ran over minTier 1..20 with the FULL budget, causing
 * every solution to consume nearly the entire pool — making the 10-statue
 * initial placement impossible.
 */
async function precomputePerBudgetFraction(
  kind: TemplateKind,
  statWeights: Partial<Record<StatKey, number>>,
  totalBudgets: Partial<Record<ConversionSet, number>>,
): Promise<Map<number, SingleStatueSolution>> {
  const results = new Map<number, SingleStatueSolution>();
  const STEPS = 20;

  for (let step = 1; step <= STEPS; step++) {
    // Budget cap for this step: step/STEPS of the total pool
    const cappedBudgets: Partial<Record<ConversionSet, number>> = {};
    for (const s of SETS) {
      cappedBudgets[s] = Math.floor(((totalBudgets[s] ?? 0) * step) / STEPS);
    }

    const model = buildModel(kind, statWeights, 1, cappedBudgets);
    let result;
    try { result = await solve(model); } catch { continue; }
    if (result.result.status !== 5) continue;

    const chosen: Array<{ featherId: FeatherId; tier: number }> = [];
    for (const [name, val] of Object.entries(result.result.vars)) {
      if (val > 0.5 && name.startsWith('y_')) {
        const parts = name.slice(2).split('_');
        const tier = parseInt(parts[parts.length - 1]);
        const featherId = parts.slice(0, parts.length - 1).join('_') as FeatherId;
        chosen.push({ featherId, tier });
      }
    }
    if (chosen.length !== 5) continue;

    const actualMinTier = Math.min(...chosen.map(c => c.tier));
    const flat = flatBonusScore(kind, statWeights, actualMinTier);
    const score = result.result.z + flat;

    // Skip duplicate solutions (same score as the previous step)
    const prevSolution = results.get(step - 1);
    if (prevSolution && Math.abs(prevSolution.score - score) < 1e-9) continue;

    const costPerSet: Partial<Record<ConversionSet, number>> = {};
    for (const { featherId, tier } of chosen) {
      const def = featherById.get(featherId)!;
      costPerSet[def.set] = (costPerSet[def.set] ?? 0) + (def.tiers[tier]?.totalCost ?? 0);
    }

    results.set(step, {
      template: { feathers: chosen.map(c => ({ feather: c.featherId, tier: c.tier })), minTier: actualMinTier },
      score,
      costPerSet,
    });
  }

  return results;
}

/**
 * Greedy upgrade loop across all 10 statues (5 attack + 5 defense).
 *
 * Starts with all statues at the lowest feasible tier, then repeatedly
 * upgrades the single statue whose best reachable tier gives the largest
 * score increase that fits within the remaining shared budget.
 * Continues until no further upgrade improves the score within budget.
 */
function greedyAllocate(
  attackSolutions: Map<number, SingleStatueSolution>,
  defenseSolutions: Map<number, SingleStatueSolution>,
  totalBudgets: Partial<Record<ConversionSet, number>>,
): { attackStatues: StatueTemplate[]; defenseStatues: StatueTemplate[]; totalScore: number; totalCost: Partial<Record<ConversionSet, number>> } | null {
  const atkTiers = Array.from(attackSolutions.keys()).sort((a, b) => a - b);
  const defTiers = Array.from(defenseSolutions.keys()).sort((a, b) => a - b);
  if (atkTiers.length === 0 || defTiers.length === 0) return null;

  // currentIdx[0..4] = index into atkTiers, [5..9] = index into defTiers
  const currentIdx = new Array(10).fill(0);

  // Initial placement: interleave attack and defense (atk0, def0, atk1, def1 …)
  // so both sides share the budget fairly rather than one side depleting it first.
  const spent: Record<ConversionSet, number> = { STDN: 0, LD: 0, DN: 0, ST: 0, Purple: 0 };
  const order = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9]; // interleaved statue indices
  for (const statue of order) {
    const isAtk = statue < 5;
    const tiers = isAtk ? atkTiers : defTiers;
    const sols = isAtk ? attackSolutions : defenseSolutions;
    let placed = false;
    for (let idx = 0; idx < tiers.length; idx++) {
      const cost = sols.get(tiers[idx])!.costPerSet;
      if (SETS.every(s => (cost[s] ?? 0) <= (totalBudgets[s] ?? 0) - spent[s])) {
        currentIdx[statue] = idx;
        for (const s of SETS) spent[s] += cost[s] ?? 0;
        placed = true;
        break;
      }
    }
    if (!placed) return null;
  }

  let improved = true;
  while (improved) {
    improved = false;
    let bestDelta = 0;
    let bestStatue = -1;
    let bestNextIdx = -1;

    for (let statue = 0; statue < 10; statue++) {
      const isAtk = statue < 5;
      const tiers = isAtk ? atkTiers : defTiers;
      const sols = isAtk ? attackSolutions : defenseSolutions;
      const curIdx = currentIdx[statue];
      const curScore = sols.get(tiers[curIdx])!.score;
      const curCost = sols.get(tiers[curIdx])!.costPerSet;

      for (let nextIdx = curIdx + 1; nextIdx < tiers.length; nextIdx++) {
        const next = sols.get(tiers[nextIdx])!;
        const scoreDelta = next.score - curScore;
        if (scoreDelta <= bestDelta) continue;
        // Check cost delta fits in remaining budget
        const fits = SETS.every(s => {
          const delta = (next.costPerSet[s] ?? 0) - (curCost[s] ?? 0);
          return delta <= (totalBudgets[s] ?? 0) - spent[s];
        });
        if (!fits) continue;
        bestDelta = scoreDelta;
        bestStatue = statue;
        bestNextIdx = nextIdx;
      }
    }

    if (bestStatue >= 0) {
      improved = true;
      const isAtk = bestStatue < 5;
      const tiers = isAtk ? atkTiers : defTiers;
      const sols = isAtk ? attackSolutions : defenseSolutions;
      const curCost = sols.get(tiers[currentIdx[bestStatue]])!.costPerSet;
      const nextCost = sols.get(tiers[bestNextIdx])!.costPerSet;
      for (const s of SETS) {
        spent[s] = spent[s] - (curCost[s] ?? 0) + (nextCost[s] ?? 0);
      }
      currentIdx[bestStatue] = bestNextIdx;
    }
  }

  const attackStatues = Array.from({ length: 5 }, (_, i) =>
    attackSolutions.get(atkTiers[currentIdx[i]])!.template,
  );
  const defenseStatues = Array.from({ length: 5 }, (_, i) =>
    defenseSolutions.get(defTiers[currentIdx[i + 5]])!.template,
  );
  const totalScore =
    Array.from({ length: 5 }, (_, i) => attackSolutions.get(atkTiers[currentIdx[i]])!.score).reduce((a, b) => a + b, 0) +
    Array.from({ length: 5 }, (_, i) => defenseSolutions.get(defTiers[currentIdx[i + 5]])!.score).reduce((a, b) => a + b, 0);

  return { attackStatues, defenseStatues, totalScore, totalCost: spent };
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
  const totalBudgets = poolBudgets(inventory);

  // Phase 1: joint feasibility check at tier 1
  const phase1Model = buildPhase1Model(statWeights, totalBudgets);
  let phase1Feasible = false;
  try {
    const p1Result = await solve(phase1Model);
    phase1Feasible = p1Result.result.status === 5; // GLP_OPT
  } catch { /* ignore, proceed to greedy */ }

  const [attackSolutions, defenseSolutions] = await Promise.all([
    precomputePerBudgetFraction('attack', statWeights, totalBudgets),
    precomputePerBudgetFraction('defense', statWeights, totalBudgets),
  ]);

  const result = greedyAllocate(attackSolutions, defenseSolutions, totalBudgets);

  if (!result) {
    return {
      ok: false,
      reason: 'infeasible',
      message: phase1Feasible
        ? 'No feasible solution found. Budget may be insufficient to fill 10 statues simultaneously.'
        : 'No feasible solution found. Check that you have enough feathers to cover all 10 statues.',
    };
  }

  return {
    ok: true,
    solution: {
      attack: result.attackStatues,
      defense: result.defenseStatues,
      spentPerSet: result.totalCost,
      totalPerSet: totalBudgets,
      score: result.totalScore,
    },
  };
}
