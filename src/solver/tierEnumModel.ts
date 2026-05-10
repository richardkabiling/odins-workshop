// src/solver/tierEnumModel.ts
// Pure model-building helpers for tier-scenario enumeration.
// No browser/React deps — safe to import in Web Workers.
import type { ConversionSet, FeatherId, StatKey, StatueTemplate } from '../domain/types';
import type { TemplateKind } from '../domain/ranking';
import type { GlpkConstraint, GlpkModel } from './glpk';
import { feathers, featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { PCT_CATEGORY_MAP } from '../domain/scoring';
import { BoundType, solve } from './glpk';
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

/**
 * Solve the LP relaxation (continuous variables) of a scenario model.
 * Returns the LP optimal value (an upper bound on the MIP), or null if LP is infeasible.
 */
export async function lpRelaxationUpperBound(
  model: GlpkModel,
): Promise<number | null> {
  // Omit `binaries` entirely so glpk.js runs simplex (LP) rather than intopt (MIP).
  // Passing `binaries: []` still triggers the MIP branch in some glpk.js versions.
  const { binaries: _omit, ...rest } = model;
  const relaxed: GlpkModel = rest;
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
