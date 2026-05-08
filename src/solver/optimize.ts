/**
 * Public optimizer entry point.
 *
 * Algorithm:
 *  1. Pool per-feather inventory into per-conversion-set budgets.
 *  2. For each of the two template kinds (attack / defense), precompute the best
 *     single-statue solution for each minTier ∈ {1..20} via ILP (budget = full per-set budget,
 *     since each ILP models ONE statue independently).
 *  3. Enumerate the C(24,5)=42,504 ordered 5-tuples of minTiers and find the combination
 *     whose total per-set cost fits within the budget and maximises total score.
 *  4. Optimize primary template statues with full budget, then secondary with remainder.
 *
 * The ×5 factor from the symmetric model is REMOVED — each statue is optimized independently.
 * Because feathers can repeat across statues, the optimal feather composition for each statue
 * is found by the per-minTier ILP, and the tier allocation across statues is found by enumeration.
 */

import type { ConversionSet, FeatherId, Inventory, Solution, StatueTemplate } from '../domain/types';
import type { PresetId, TemplateKind } from '../domain/presets';
import { PRESETS, SIBLING } from '../domain/presets';
import { feathers, featherById } from '../data/feathers.generated';
import { buildModel, flatBonusScore } from './buildModel';
import { solve } from './glpk';

export type OptimizeResult =
  | { ok: true; solution: Solution }
  | { ok: false; reason: 'infeasible' | 'error'; message?: string };

const SETS: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];

export function derivePresetId(atkPct: number, pvp: boolean): PresetId {
  const atkFirst = atkPct >= 50;
  if (pvp) return atkFirst ? 'PvP_Atk' : 'PvP_Def';
  return atkFirst ? 'PvE_Atk' : 'PvE_Def';
}

export function splitBudgets(
  total: Partial<Record<ConversionSet, number>>,
  atkPct: number,
): { attack: Partial<Record<ConversionSet, number>>; defense: Partial<Record<ConversionSet, number>> } {
  const attack: Partial<Record<ConversionSet, number>> = {};
  const defense: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    const t = total[s] ?? 0;
    const a = Math.floor(t * atkPct / 100);
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

/** Solve a single-statue ILP for each minTier. Returns a map from minTier → solution. */
async function precomputePerMinTier(
  kind: TemplateKind,
  presetId: PresetId,
  budgets: Partial<Record<ConversionSet, number>>,
): Promise<Map<number, SingleStatueSolution>> {
  const preset = PRESETS[presetId];
  const results = new Map<number, SingleStatueSolution>();

  for (let minTier = 1; minTier <= 20; minTier++) {
    const model = buildModel(kind, preset, minTier, budgets);
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

    const flat = flatBonusScore(kind, preset, minTier);
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

function addCosts(
  acc: Partial<Record<ConversionSet, number>>,
  add: Partial<Record<ConversionSet, number>>,
): Partial<Record<ConversionSet, number>> {
  const out = { ...acc };
  for (const s of SETS) {
    const v = add[s] ?? 0;
    if (v) out[s] = (out[s] ?? 0) + v;
  }
  return out;
}

function withinBudget(
  cost: Partial<Record<ConversionSet, number>>,
  budget: Partial<Record<ConversionSet, number>>,
): boolean {
  return SETS.every(s => (cost[s] ?? 0) <= (budget[s] ?? 0));
}

/**
 * Given precomputed per-minTier solutions for a single statue, find the best ordered
 * 5-tuple (m1 ≤ m2 ≤ m3 ≤ m4 ≤ m5) whose combined cost fits within the budget.
 *
 * Returns the 5 StatueTemplate instances (one per statue) and total cost.
 */
function findBestAllocation(
  solutions: Map<number, SingleStatueSolution>,
  budgets: Partial<Record<ConversionSet, number>>,
): { statues: StatueTemplate[]; totalScore: number; totalCost: Partial<Record<ConversionSet, number>> } | null {
  const validTiers = Array.from(solutions.keys()).sort((a, b) => a - b);
  if (validTiers.length === 0) return null;

  let bestScore = -Infinity;
  let bestStatues: StatueTemplate[] | null = null;
  let bestCost: Partial<Record<ConversionSet, number>> = {};

  // Enumerate ordered 5-tuples (m1 ≤ m2 ≤ m3 ≤ m4 ≤ m5)
  // Using indices into validTiers for efficiency
  const n = validTiers.length;
  for (let i0 = 0; i0 < n; i0++) {
    const s0 = solutions.get(validTiers[i0])!;
    const cost0 = s0.costPerSet;
    for (let i1 = i0; i1 < n; i1++) {
      const s1 = solutions.get(validTiers[i1])!;
      const cost01 = addCosts(cost0, s1.costPerSet);
      if (!withinBudget(cost01, budgets)) continue; // prune: already over budget with 2
      // Actually don't prune here — higher tiers add more cost but we're building up
      for (let i2 = i1; i2 < n; i2++) {
        const s2 = solutions.get(validTiers[i2])!;
        const cost012 = addCosts(cost01, s2.costPerSet);
        for (let i3 = i2; i3 < n; i3++) {
          const s3 = solutions.get(validTiers[i3])!;
          const cost0123 = addCosts(cost012, s3.costPerSet);
          for (let i4 = i3; i4 < n; i4++) {
            const s4 = solutions.get(validTiers[i4])!;
            const totalCost = addCosts(cost0123, s4.costPerSet);
            if (!withinBudget(totalCost, budgets)) continue;
            const totalScore = s0.score + s1.score + s2.score + s3.score + s4.score;
            if (totalScore > bestScore) {
              bestScore = totalScore;
              bestStatues = [s0.template, s1.template, s2.template, s3.template, s4.template];
              bestCost = totalCost;
            }
          }
        }
      }
    }
  }

  if (!bestStatues) return null;
  return { statues: bestStatues, totalScore: bestScore, totalCost: bestCost };
}

function subtractCost(
  budgets: Partial<Record<ConversionSet, number>>,
  cost: Partial<Record<ConversionSet, number>>,
): Partial<Record<ConversionSet, number>> {
  const remaining: Partial<Record<ConversionSet, number>> = { ...budgets };
  for (const [setId, spent] of Object.entries(cost) as [ConversionSet, number][]) {
    remaining[setId] = Math.max(0, (remaining[setId] ?? 0) - spent);
  }
  return remaining;
}

export async function optimize(
  inventory: Inventory,
  presetId: PresetId,
): Promise<OptimizeResult> {
  const preset = PRESETS[presetId];
  const budgets = poolBudgets(inventory);

  // Scale budgets to per-statue allowance for single-statue ILPs.
  // findBestAllocation checks combined 5-statue cost against full budgets.
  const singleStatueBudgets: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) singleStatueBudgets[s] = Math.floor((budgets[s] ?? 0) / 5);

  // Primary template: solve 20 single-statue ILPs, then find best 5-tuple allocation
  const primarySolutions = await precomputePerMinTier(preset.primaryTemplate, presetId, singleStatueBudgets);
  const primaryAlloc = findBestAllocation(primarySolutions, budgets);

  if (!primaryAlloc) {
    return {
      ok: false,
      reason: 'infeasible',
      message: 'No feasible solution for primary template. Check that you have enough feathers (need at least 4 orange + 1 purple eligible for the chosen statue type).',
    };
  }

  // Secondary template: solve with remaining budget
  const remainingBudgets = subtractCost(budgets, primaryAlloc.totalCost);
  const secondaryKind: TemplateKind = preset.primaryTemplate === 'attack' ? 'defense' : 'attack';
  const secondaryPresetId = SIBLING[presetId];
  const remainingSingleStatueBudgets: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) remainingSingleStatueBudgets[s] = Math.floor((remainingBudgets[s] ?? 0) / 5);
  const secondarySolutions = await precomputePerMinTier(secondaryKind, secondaryPresetId, remainingSingleStatueBudgets);
  const secondaryAlloc = findBestAllocation(secondarySolutions, remainingBudgets);

  const emptyStatues: StatueTemplate[] = Array.from({ length: 5 }, () => ({ feathers: [], minTier: 0 }));
  const secondaryStatues = secondaryAlloc?.statues ?? emptyStatues;

  const attackStatues = preset.primaryTemplate === 'attack' ? primaryAlloc.statues : secondaryStatues;
  const defenseStatues = preset.primaryTemplate === 'defense' ? primaryAlloc.statues : secondaryStatues;

  const spentPerSet = { ...primaryAlloc.totalCost };
  if (secondaryAlloc) {
    for (const [s, v] of Object.entries(secondaryAlloc.totalCost) as [ConversionSet, number][]) {
      spentPerSet[s] = (spentPerSet[s] ?? 0) + v;
    }
  }

  return {
    ok: true,
    solution: {
      attack: attackStatues,
      defense: defenseStatues,
      spentPerSet,
      score: primaryAlloc.totalScore,
    },
  };
}
