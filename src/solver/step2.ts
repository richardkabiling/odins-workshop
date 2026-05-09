/**
 * Step 2 of the two-step optimizer: iterative upgrade greedy.
 *
 * Starting from the 10 statues produced by Step 1 (all feathers at tier 1),
 * repeatedly applies the single best feasible upgrade move until no move
 * improves the score within the remaining pool budget.
 *
 * Two move types:
 *   (A) Single-feather upgrade — raise one slot from tier t to t+1.
 *   (B) Lift statue min-tier — raise every feather currently at the statue's
 *       minimum tier to the next tier. This is the only way to increase the
 *       set-bonus pct tier.
 *
 * Best move is chosen by:
 *   efficiency = Δscore / fractional_pressure
 *   fractional_pressure = Σ_s (Δcost[s] / poolRemaining[s])
 *
 * Tie-break: higher Δscore wins.
 */

import type { ConversionSet, StatueTemplate, FeatherInstance, StatKey } from '../domain/types';
import type { TemplateKind } from '../domain/ranking';
import { featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { computeStatueStats } from '../domain/scoring';

const SETS: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];

export interface UpgradeState {
  attack: StatueTemplate[];
  defense: StatueTemplate[];
  poolRemaining: Partial<Record<ConversionSet, number>>;
}

interface Move {
  statueIdx: number;
  kind: TemplateKind;
  type: 'single' | 'lift';
  slotIdx?: number;
  efficiency: number;
  deltaScore: number;
  deltaCost: Partial<Record<ConversionSet, number>>;
  newFeathers: FeatherInstance[];
}

/**
 * Compute the weighted score for a single statue.
 * minTier drives which SetBonus is applied.
 */
function statueScore(
  template: StatueTemplate,
  kind: TemplateKind,
  weights: Partial<Record<StatKey, number>>,
  normFactors: Partial<Record<StatKey, number>> = {},
): number {
  const minTier = template.feathers.reduce((m, f) => Math.min(m, f.tier), Infinity);
  const bonus = kind === 'attack' ? getAttackBonus(minTier) : getDefenseBonus(minTier);
  const stats = computeStatueStats(template, bonus);
  return Object.entries(weights).reduce(
    (s, [k, w]) => {
      const norm = normFactors[k as StatKey] ?? 1;
      return s + ((stats[k as StatKey] ?? 0) / norm) * (w ?? 0);
    },
    0,
  );
}

/**
 * Try to build a candidate Move for the given statue and move type.
 * Returns null if:
 *   - the move is not applicable (already at max tier, costToNext is null)
 *   - it is not feasible (insufficient pool budget)
 *   - Δscore ≤ 0
 */
function tryMove(
  template: StatueTemplate,
  kind: TemplateKind,
  statueIdx: number,
  poolRemaining: Partial<Record<ConversionSet, number>>,
  weights: Partial<Record<StatKey, number>>,
  type: 'single' | 'lift',
  normFactors: Partial<Record<StatKey, number>>,
  slotIdx?: number,
): Move | null {
  const newFeathers = template.feathers.map(f => ({ ...f }));

  const deltaCost: Partial<Record<ConversionSet, number>> = {};

  if (type === 'single') {
    const slot = newFeathers[slotIdx!];
    if (slot.tier >= 20) return null;
    const def = featherById.get(slot.feather)!;
    const costToNext = def.tiers[slot.tier]?.costToNext;
    if (costToNext == null) return null;

    // Feasibility
    if (costToNext > (poolRemaining[def.set] ?? 0)) return null;

    deltaCost[def.set] = costToNext;
    slot.tier++;
  } else {
    // lift: raise every feather at the statue's current minTier
    const minTier = template.feathers.reduce((m, f) => Math.min(m, f.tier), Infinity);
    if (minTier >= 20) return null;

    for (const nf of newFeathers) {
      if (nf.tier !== minTier) continue;
      const def = featherById.get(nf.feather)!;
      const costToNext = def.tiers[nf.tier]?.costToNext;
      if (costToNext == null) return null;
      deltaCost[def.set] = (deltaCost[def.set] ?? 0) + costToNext;
      nf.tier++;
    }

    // Feasibility: every touched set must have enough budget
    for (const [s, cost] of Object.entries(deltaCost) as [ConversionSet, number][]) {
      if (cost > (poolRemaining[s] ?? 0)) return null;
    }
  }

  const before = statueScore(template, kind, weights, normFactors);
  const newTemplate: StatueTemplate = {
    feathers: newFeathers,
    minTier: Math.min(...newFeathers.map(f => f.tier)),
  };
  const after = statueScore(newTemplate, kind, weights, normFactors);
  const deltaScore = after - before;
  if (deltaScore <= 0) return null;

  // fractional_pressure = Σ_s (Δcost[s] / poolRemaining[s])
  let fractionalPressure = 0;
  for (const [s, cost] of Object.entries(deltaCost) as [ConversionSet, number][]) {
    const rem = poolRemaining[s] ?? 0;
    if (rem <= 0) return null;
    fractionalPressure += cost / rem;
  }

  const efficiency = deltaScore / fractionalPressure;

  return {
    statueIdx,
    kind,
    type,
    slotIdx,
    efficiency,
    deltaScore,
    deltaCost,
    newFeathers,
  };
}

/**
 * Iterate upgrades until no feasible improvement remains.
 * Returns a new UpgradeState with updated statues and poolRemaining.
 */
export function iterateUpgrades(
  state: UpgradeState,
  weights: Partial<Record<StatKey, number>>,
  attackNormFactors: Partial<Record<StatKey, number>> = {},
  defenseNormFactors: Partial<Record<StatKey, number>> = {},
): UpgradeState {
  // Deep-copy mutable state
  const attack: StatueTemplate[] = state.attack.map(t => ({
    feathers: t.feathers.map(f => ({ ...f })),
    minTier: t.minTier,
  }));
  const defense: StatueTemplate[] = state.defense.map(t => ({
    feathers: t.feathers.map(f => ({ ...f })),
    minTier: t.minTier,
  }));
  const poolRemaining: Partial<Record<ConversionSet, number>> = { ...state.poolRemaining };

  while (true) {
    const candidates: Move[] = [];

    for (let i = 0; i < 5; i++) {
      // Move A: single-feather upgrades
      for (let slotIdx = 0; slotIdx < attack[i].feathers.length; slotIdx++) {
        const m = tryMove(attack[i], 'attack', i, poolRemaining, weights, 'single', attackNormFactors, slotIdx);
        if (m) candidates.push(m);
      }
      // Move B: lift
      const liftA = tryMove(attack[i], 'attack', i, poolRemaining, weights, 'lift', attackNormFactors);
      if (liftA) candidates.push(liftA);
    }

    for (let i = 0; i < 5; i++) {
      for (let slotIdx = 0; slotIdx < defense[i].feathers.length; slotIdx++) {
        const m = tryMove(defense[i], 'defense', i, poolRemaining, weights, 'single', defenseNormFactors, slotIdx);
        if (m) candidates.push(m);
      }
      const liftD = tryMove(defense[i], 'defense', i, poolRemaining, weights, 'lift', defenseNormFactors);
      if (liftD) candidates.push(liftD);
    }

    if (candidates.length === 0) break;

    // Pick argmax efficiency; tie-break by higher Δscore
    candidates.sort((a, b) => {
      const diff = b.efficiency - a.efficiency;
      if (Math.abs(diff) > 1e-12) return diff;
      return b.deltaScore - a.deltaScore;
    });

    const best = candidates[0];
    if (best.deltaScore <= 0) break;

    // Apply the move
    const statues = best.kind === 'attack' ? attack : defense;
    statues[best.statueIdx].feathers = best.newFeathers;
    statues[best.statueIdx].minTier = Math.min(...best.newFeathers.map(f => f.tier));

    for (const [s, cost] of Object.entries(best.deltaCost) as [ConversionSet, number][]) {
      poolRemaining[s] = (poolRemaining[s] ?? 0) - cost;
    }
  }

  return { attack, defense, poolRemaining };
}

/**
 * Compute total weighted score across all 10 statues in a final UpgradeState.
 */
export function totalScore(
  state: UpgradeState,
  weights: Partial<Record<StatKey, number>>,
  attackNormFactors: Partial<Record<StatKey, number>> = {},
  defenseNormFactors: Partial<Record<StatKey, number>> = {},
): number {
  let score = 0;
  for (const statue of state.attack) {
    score += statueScore(statue, 'attack', weights, attackNormFactors);
  }
  for (const statue of state.defense) {
    score += statueScore(statue, 'defense', weights, defenseNormFactors);
  }
  return score;
}

/** Re-export for convenience */
export { SETS };
