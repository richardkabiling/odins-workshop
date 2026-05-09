/**
 * Builds a glpk.js ILP model for ONE statue (not the whole 5-statue group).
 *
 * For a fixed minTier, the problem is linear:
 *   Variables: y[f][t] ∈ {0,1}  for each eligible feather f, tier t ≥ minTier
 *   Objective: maximize Σ weight[stat] × stat_value[f][t] × (1 + pct/100)  (per feather stat)
 *              Flat set bonuses are a constant for fixed minTier and added separately.
 *   Constraints:
 *     1. Exactly 5 feathers
 *     2. Each feather at most once
 *     3. Exactly 4 orange, 1 purple
 *     4. Per-conversion-set budget for this single statue
 */

import type { FeatherDef, ConversionSet, StatKey } from '../domain/types';
import type { TemplateKind } from '../domain/presets';
import type { GlpkModel, GlpkConstraint } from './glpk';
import { BoundType } from './glpk';
import { feathers } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { PCT_CATEGORY_MAP } from '../domain/scoring';

function eligibleFeathers(kind: TemplateKind): FeatherDef[] {
  return feathers.filter(f =>
    kind === 'attack'
      ? f.type === 'Attack' || f.type === 'Hybrid'
      : f.type === 'Defense' || f.type === 'Hybrid',
  );
}

function varName(featherId: string, tier: number) {
  return `y_${featherId}_${tier}`;
}

function phase1VarName(statueIdx: number, featherId: string) {
  return `x_${statueIdx}_${featherId}`;
}

export function buildModel(
  kind: TemplateKind,
  statWeights: Partial<Record<StatKey, number>>,
  minTier: number,
  budgets: Partial<Record<ConversionSet, number>>,
): GlpkModel {
  const eligible = eligibleFeathers(kind);
  const bonus = kind === 'attack' ? getAttackBonus(minTier) : getDefenseBonus(minTier);

  const objVars: { name: string; coef: number }[] = [];
  const binaries: string[] = [];

  for (const feather of eligible) {
    for (let t = minTier; t <= 20; t++) {
      const tierData = feather.tiers[t];
      if (!tierData) continue;

      let coef = 0;
      for (const [statStr, val] of Object.entries(tierData.stats) as [StatKey, number][]) {
        const weight = statWeights[statStr] ?? 0;
        if (weight === 0) continue;
        const pctCat = PCT_CATEGORY_MAP[statStr];
        const pct = pctCat ? (bonus.pct[pctCat] ?? 0) : 0;
        coef += val * weight * (1 + pct / 100);
      }

      const name = varName(feather.id, t);
      objVars.push({ name, coef }); // coef=0 is fine for GLPK
      binaries.push(name);
    }
  }

  const constraints: GlpkConstraint[] = [];

  // 1. Exactly 5 feathers
  constraints.push({
    name: 'total_feathers',
    vars: binaries.map(name => ({ name, coef: 1 })),
    bnds: { type: BoundType.FX, lb: 5, ub: 5 },
  });

  // 2. Each feather at most once
  for (const feather of eligible) {
    const vars: { name: string; coef: number }[] = [];
    for (let t = minTier; t <= 20; t++) {
      const name = varName(feather.id, t);
      if (binaries.includes(name)) vars.push({ name, coef: 1 });
    }
    if (vars.length === 0) continue;
    constraints.push({
      name: `once_${feather.id}`,
      vars,
      bnds: { type: BoundType.UP, lb: 0, ub: 1 },
    });
  }

  // 3. Rarity counts: 4 orange, 1 purple
  const rarityVars = (rarity: 'Orange' | 'Purple') =>
    eligible
      .filter(f => f.rarity === rarity)
      .flatMap(f => {
        const out: { name: string; coef: number }[] = [];
        for (let t = minTier; t <= 20; t++) {
          const name = varName(f.id, t);
          if (binaries.includes(name)) out.push({ name, coef: 1 });
        }
        return out;
      });

  const orangeVars = rarityVars('Orange');
  const purpleVars = rarityVars('Purple');
  if (orangeVars.length > 0) constraints.push({ name: 'orange_count', vars: orangeVars, bnds: { type: BoundType.FX, lb: 4, ub: 4 } });
  if (purpleVars.length > 0) constraints.push({ name: 'purple_count', vars: purpleVars, bnds: { type: BoundType.FX, lb: 1, ub: 1 } });

  // 4. Per-conversion-set budget for this single statue
  const sets: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];
  for (const convSet of sets) {
    const budget = budgets[convSet] ?? 0;
    const feathersInSet = eligible.filter(f => f.set === convSet);
    const costVars = feathersInSet.flatMap(feather => {
      const out: { name: string; coef: number }[] = [];
      for (let t = minTier; t <= 20; t++) {
        const name = varName(feather.id, t);
        if (!binaries.includes(name)) continue;
        out.push({ name, coef: feather.tiers[t]?.totalCost ?? 0 });
      }
      return out;
    });
    if (costVars.length === 0) continue;
    constraints.push({
      name: `budget_${convSet}`,
      vars: costVars,
      bnds: { type: BoundType.UP, lb: 0, ub: budget },
    });
  }

  return {
    name: `${kind}_m${minTier}`,
    objective: { direction: 2, name: 'score', vars: objVars },
    subjectTo: constraints,
    binaries,
  };
}

/**
 * Builds a joint ILP for all 10 statues at minTier=1.
 * Used for phase-1 initial placement before the greedy tier-upgrade pass.
 *
 * Variables: x_{s}_{featherId} ∈ {0,1}  for s ∈ 0..9 (0-4 = attack, 5-9 = defense)
 *
 * Per-statue constraints:
 *   Σ_f x_{s,f} = 5        (exactly 5 feathers per statue)
 *   Σ_{orange f} x_{s,f} = 4  (4 orange)
 *   Σ_{purple f} x_{s,f} = 1  (1 purple)
 *
 * Global per-set budget:
 *   Σ_s Σ_{f ∈ convSet c} x_{s,f} × tier1Cost(f) ≤ totalBudgets[c]
 *   (tier1Cost = feather.tiers[1].totalCost)
 *
 * Objective: maximize Σ_s Σ_f x_{s,f} × scoreCoeff(f, tier=1, kindOf(s))
 *   where scoreCoeff uses statWeights and set-bonus pct for minTier=1
 *   kindOf(s) = 'attack' for s < 5, 'defense' for s >= 5
 *
 * @param statWeights  derived from the stat ranking
 * @param totalBudgets per-set pool budget
 * @returns GlpkModel ready to pass to solve()
 */
export function buildPhase1Model(
  statWeights: Partial<Record<StatKey, number>>,
  totalBudgets: Partial<Record<ConversionSet, number>>,
): GlpkModel {
  const attackBonus = getAttackBonus(1);
  const defenseBonus = getDefenseBonus(1);

  const attackEligible = eligibleFeathers('attack');
  const defenseEligible = eligibleFeathers('defense');

  const objVars: { name: string; coef: number }[] = [];
  const binaries: string[] = [];

  // Per-statue variable lists, keyed by statueIdx
  const statueVars: Map<number, string[]> = new Map();
  const statueOrangeVars: Map<number, string[]> = new Map();
  const statuePurpleVars: Map<number, string[]> = new Map();

  for (let s = 0; s < 10; s++) {
    const kind: TemplateKind = s < 5 ? 'attack' : 'defense';
    const bonus = kind === 'attack' ? attackBonus : defenseBonus;
    const eligible = s < 5 ? attackEligible : defenseEligible;

    const varsForStatue: string[] = [];
    const orangeVarsForStatue: string[] = [];
    const purpleVarsForStatue: string[] = [];

    for (const feather of eligible) {
      const tierData = feather.tiers[1];
      if (!tierData) continue;

      const name = phase1VarName(s, feather.id);
      binaries.push(name);
      varsForStatue.push(name);

      if (feather.rarity === 'Orange') orangeVarsForStatue.push(name);
      else purpleVarsForStatue.push(name);

      let coef = 0;
      for (const [statStr, val] of Object.entries(tierData.stats) as [StatKey, number][]) {
        const weight = statWeights[statStr] ?? 0;
        if (weight === 0) continue;
        const pctCat = PCT_CATEGORY_MAP[statStr];
        const pct = pctCat ? (bonus.pct[pctCat] ?? 0) : 0;
        coef += val * weight * (1 + pct / 100);
      }

      objVars.push({ name, coef });
    }

    statueVars.set(s, varsForStatue);
    statueOrangeVars.set(s, orangeVarsForStatue);
    statuePurpleVars.set(s, purpleVarsForStatue);
  }

  const constraints: GlpkConstraint[] = [];

  // Per-statue constraints: exactly 5 feathers, 4 orange, 1 purple
  for (let s = 0; s < 10; s++) {
    const allVars = statueVars.get(s) ?? [];
    const orangeVars = statueOrangeVars.get(s) ?? [];
    const purpleVars = statuePurpleVars.get(s) ?? [];

    constraints.push({
      name: `total_feathers_s${s}`,
      vars: allVars.map(name => ({ name, coef: 1 })),
      bnds: { type: BoundType.FX, lb: 5, ub: 5 },
    });

    if (orangeVars.length > 0) {
      constraints.push({
        name: `orange_count_s${s}`,
        vars: orangeVars.map(name => ({ name, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 4, ub: 4 },
      });
    }

    if (purpleVars.length > 0) {
      constraints.push({
        name: `purple_count_s${s}`,
        vars: purpleVars.map(name => ({ name, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 1, ub: 1 },
      });
    }
  }

  // Global per-set budget across all statues
  const sets: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];
  for (const convSet of sets) {
    const budget = totalBudgets[convSet] ?? 0;
    const costVars: { name: string; coef: number }[] = [];

    for (let s = 0; s < 10; s++) {
      const eligible = s < 5 ? attackEligible : defenseEligible;
      const feathersInSet = eligible.filter(f => f.set === convSet);

      for (const feather of feathersInSet) {
        const name = phase1VarName(s, feather.id);
        if (!binaries.includes(name)) continue;
        const tier1Cost = feather.tiers[1]?.totalCost ?? 0;
        costVars.push({ name, coef: tier1Cost });
      }
    }

    if (costVars.length === 0) continue;
    constraints.push({
      name: `budget_${convSet}`,
      vars: costVars,
      bnds: { type: BoundType.UP, lb: 0, ub: budget },
    });
  }

  return {
    name: 'phase1_joint',
    objective: { direction: 2, name: 'score', vars: objVars },
    subjectTo: constraints,
    binaries,
  };
}

/**
 * Flat set bonus score for a single statue (no pct applied — flat is added after pct per corrected formula).
 */
export function flatBonusScore(
  kind: TemplateKind,
  statWeights: Partial<Record<StatKey, number>>,
  minTier: number,
): number {
  const bonus = kind === 'attack' ? getAttackBonus(minTier) : getDefenseBonus(minTier);
  let flat = 0;
  for (const [statStr, val] of Object.entries(bonus.flat) as [StatKey, number][]) {
    const weight = statWeights[statStr] ?? 0;
    if (weight === 0) continue;
    flat += val * weight; // flat is NOT multiplied by pct per corrected formula
  }
  return flat;
}
