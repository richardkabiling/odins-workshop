/**
 * Public optimizer entry point.
 *
 * Algorithm:
 *  1. Pool per-feather inventory into per-conversion-set budgets.
 *  2. Both attack and defense statue templates use the same blended stat weights
 *     derived from offensivePct. This maximizes total stats across all 10 statues
 *     weighted by the user's offensive/defensive preference.
 *  3. For each template kind, precompute the best single-statue solution for each
 *     minTier ∈ {1..20} via ILP, using the full total budget as the per-statue
 *     upper bound (so hybrid feathers in defense statues can score offensive stats).
 *  4. Enumerate all valid (attack 5-tuple, defense 5-tuple) pairs and find the
 *     combination maximising total score within the shared budget.
 *     Both sides compete for the same pool — no upfront budget split.
 */

import type { ConversionSet, FeatherId, Inventory, InventoryDiagnostic, Solution, StatueTemplate, StatKey } from '../domain/types';
import type { TemplateKind } from '../domain/presets';
import { makeBlendedWeights } from '../domain/presets';
import { feathers, featherById } from '../data/feathers.generated';
import { buildModel, flatBonusScore } from './buildModel';
import { solve } from './glpk';

export type OptimizeResult =
  | { ok: true; solution: Solution }
  | { ok: false; reason: 'infeasible' | 'error'; message?: string }
  | { ok: false; reason: 'inventory'; diagnostics: InventoryDiagnostic[] };

const SETS: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];

/** Which statue type is primary (gets first pick of budget). */
export function derivePrimaryKind(offensivePct: number): TemplateKind {
  return offensivePct >= 50 ? 'attack' : 'defense';
}

export function splitBudgets(
  total: Partial<Record<ConversionSet, number>>,
  offensivePct: number,
): { attack: Partial<Record<ConversionSet, number>>; defense: Partial<Record<ConversionSet, number>> } {
  const attack: Partial<Record<ConversionSet, number>> = {};
  const defense: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    const t = total[s] ?? 0;
    const a = Math.floor(t * offensivePct / 100);
    attack[s] = a;
    defense[s] = t - a;
  }
  return { attack, defense };
}

function poolBudgets(inventory: Inventory): Partial<Record<ConversionSet, number>> {
  const budgets: Partial<Record<ConversionSet, number>> = {};
  for (const featherDef of feathers) {
    const count = inventory.perFeather[featherDef.id as FeatherId] ?? 0;
    budgets[featherDef.set] = (budgets[featherDef.set] ?? 0) + count;
  }
  return budgets;
}

interface SingleStatueSolution {
  template: StatueTemplate;
  score: number;                                    // weighted score for this statue
  costPerSet: Partial<Record<ConversionSet, number>>;
}

/**
 * Solve a single-statue ILP for each minTier.
 * `budgets` is used as an upper bound in the ILP — pass the total budget so
 * the solver isn't artificially constrained to 1/5th of available resources.
 * The joint allocation enforces the real shared-pool constraint.
 */
async function precomputePerMinTier(
  kind: TemplateKind,
  statWeights: Partial<Record<StatKey, number>>,
  budgets: Partial<Record<ConversionSet, number>>,
): Promise<Map<number, SingleStatueSolution>> {
  const results = new Map<number, SingleStatueSolution>();

  for (let minTier = 1; minTier <= 20; minTier++) {
    const model = buildModel(kind, statWeights, minTier, budgets);
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

    const flat = flatBonusScore(kind, statWeights, minTier);
    const score = result.result.z + flat;

    const costPerSet: Partial<Record<ConversionSet, number>> = {};
    for (const { featherId, tier } of chosen) {
      const def = featherById.get(featherId)!;
      costPerSet[def.set] = (costPerSet[def.set] ?? 0) + (def.tiers[tier]?.totalCost ?? 0);
    }

    results.set(minTier, {
      template: { feathers: chosen.map(c => ({ feather: c.featherId, tier: c.tier })), minTier },
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
  offensivePct: number,
  pvp: boolean,
): Promise<OptimizeResult> {
  const statWeights = makeBlendedWeights(offensivePct, pvp);
  const totalBudgets = poolBudgets(inventory);

  // Per-statue ILP budget: floor(total / 5). Worst case one kind gets all budget
  // across its 5 statues, so each statue can spend at most total / 5. The greedy's
  // per-upgrade delta check enforces the real shared-pool constraint at runtime.
  const perStatueBudgets: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) perStatueBudgets[s] = Math.floor((totalBudgets[s] ?? 0) / 5);

  const [attackSolutions, defenseSolutions] = await Promise.all([
    precomputePerMinTier('attack', statWeights, perStatueBudgets),
    precomputePerMinTier('defense', statWeights, perStatueBudgets),
  ]);

  const result = greedyAllocate(attackSolutions, defenseSolutions, totalBudgets);

  if (!result) {
    return {
      ok: false,
      reason: 'infeasible',
      message: 'No feasible solution found. Check that you have enough feathers (need at least 4 orange + 1 purple eligible for each statue type).',
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
