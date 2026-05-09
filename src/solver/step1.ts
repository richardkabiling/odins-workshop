/**
 * Step 1 of the two-step optimizer: joint T1 ILP.
 *
 * Selects how many copies of each feather appear across the 5 attack statues
 * (xA[f] ∈ {0..5}) and the 5 defense statues (xD[f] ∈ {0..5}), maximising
 * the weighted score at tier-1 set-bonus pct while respecting per-set pool
 * budgets.
 *
 * Post-solve, feathers are distributed into 5 statues per kind via round-robin
 * (orange copies first, then purple) so each statue ends up with exactly
 * 4 orange + 1 purple feathers, all at tier 1.
 */

import type { ConversionSet, FeatherId, StatueTemplate, StatKey } from '../domain/types';
import type { TemplateKind } from '../domain/ranking';
import type { GlpkConstraint, GlpkModel } from './glpk';
import { feathers, featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { PCT_CATEGORY_MAP } from '../domain/scoring';
import { solve, BoundType } from './glpk';

const SETS: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];

function eligibleFeathers(kind: TemplateKind) {
  return feathers.filter(f =>
    kind === 'attack'
      ? f.type === 'Attack' || f.type === 'Hybrid'
      : f.type === 'Defense' || f.type === 'Hybrid',
  );
}

function scoreCoeff(
  featherId: FeatherId,
  kind: TemplateKind,
  statWeights: Partial<Record<StatKey, number>>,
): number {
  const def = featherById.get(featherId)!;
  const bonus = kind === 'attack' ? getAttackBonus(1) : getDefenseBonus(1);
  const tierData = def.tiers[1];
  if (!tierData) return 0;
  let coef = 0;
  for (const [statStr, val] of Object.entries(tierData.stats) as [StatKey, number][]) {
    const weight = statWeights[statStr] ?? 0;
    if (weight === 0) continue;
    const pctCat = PCT_CATEGORY_MAP[statStr];
    const pct = pctCat ? (bonus.pct[pctCat] ?? 0) : 0;
    coef += val * weight * (1 + pct / 100);
  }
  return coef;
}

export interface Step1Result {
  attack: StatueTemplate[];
  defense: StatueTemplate[];
  poolRemaining: Partial<Record<ConversionSet, number>>;
}

/**
 * Solve the joint T1 ILP and return 5 attack + 5 defense StatueTemplates (all
 * feathers at tier 1) plus the remaining per-set pool budget.
 *
 * Returns null if GLPK reports infeasibility or throws.
 */
export async function solveT1Setup(
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Partial<Record<StatKey, number>>,
): Promise<Step1Result | null> {
  const attackEligible = eligibleFeathers('attack');
  const defenseEligible = eligibleFeathers('defense');

  const objVars: { name: string; coef: number }[] = [];
  const generals: string[] = [];
  const constraints: GlpkConstraint[] = [];

  const atkVarOf = (id: FeatherId) => `xA_${id}`;
  const defVarOf = (id: FeatherId) => `xD_${id}`;

  // Declare attack variables
  for (const f of attackEligible) {
    const name = atkVarOf(f.id as FeatherId);
    generals.push(name);
    objVars.push({ name, coef: scoreCoeff(f.id as FeatherId, 'attack', statWeights) });
    // Upper bound: at most 5 copies (one per statue)
    constraints.push({
      name: `ub_xA_${f.id}`,
      vars: [{ name, coef: 1 }],
      bnds: { type: BoundType.UP, lb: 0, ub: 5 },
    });
  }

  // Declare defense variables
  for (const f of defenseEligible) {
    const name = defVarOf(f.id as FeatherId);
    generals.push(name);
    objVars.push({ name, coef: scoreCoeff(f.id as FeatherId, 'defense', statWeights) });
    constraints.push({
      name: `ub_xD_${f.id}`,
      vars: [{ name, coef: 1 }],
      bnds: { type: BoundType.UP, lb: 0, ub: 5 },
    });
  }

  // Orange / purple slot counts (5 statues × 4 orange = 20; 5 × 1 purple = 5)
  const atkOrange = attackEligible.filter(f => f.rarity === 'Orange').map(f => ({ name: atkVarOf(f.id as FeatherId), coef: 1 }));
  const atkPurple = attackEligible.filter(f => f.rarity === 'Purple').map(f => ({ name: atkVarOf(f.id as FeatherId), coef: 1 }));
  const defOrange = defenseEligible.filter(f => f.rarity === 'Orange').map(f => ({ name: defVarOf(f.id as FeatherId), coef: 1 }));
  const defPurple = defenseEligible.filter(f => f.rarity === 'Purple').map(f => ({ name: defVarOf(f.id as FeatherId), coef: 1 }));

  if (atkOrange.length > 0) constraints.push({ name: 'atk_orange', vars: atkOrange, bnds: { type: BoundType.FX, lb: 20, ub: 20 } });
  if (atkPurple.length > 0) constraints.push({ name: 'atk_purple', vars: atkPurple, bnds: { type: BoundType.FX, lb: 5, ub: 5 } });
  if (defOrange.length > 0) constraints.push({ name: 'def_orange', vars: defOrange, bnds: { type: BoundType.FX, lb: 20, ub: 20 } });
  if (defPurple.length > 0) constraints.push({ name: 'def_purple', vars: defPurple, bnds: { type: BoundType.FX, lb: 5, ub: 5 } });

  // Per-set pool constraints: Σ_{f ∈ s} (xA[f] + xD[f]) × tier1Cost(f) ≤ pool[s]
  for (const s of SETS) {
    const budget = poolInitial[s] ?? 0;
    const costVars: { name: string; coef: number }[] = [];

    for (const f of attackEligible.filter(ftr => ftr.set === s)) {
      const tier1Cost = f.tiers[1]?.totalCost ?? 0;
      costVars.push({ name: atkVarOf(f.id as FeatherId), coef: tier1Cost });
    }
    for (const f of defenseEligible.filter(ftr => ftr.set === s)) {
      const tier1Cost = f.tiers[1]?.totalCost ?? 0;
      costVars.push({ name: defVarOf(f.id as FeatherId), coef: tier1Cost });
    }

    if (costVars.length > 0) {
      constraints.push({
        name: `pool_${s}`,
        vars: costVars,
        bnds: { type: BoundType.UP, lb: 0, ub: budget },
      });
    }
  }

  const model: GlpkModel = {
    name: 'step1_t1',
    objective: { direction: 2, name: 'score', vars: objVars },
    subjectTo: constraints,
    generals,
  };

  let result;
  try {
    result = await solve(model);
  } catch {
    return null;
  }
  if (result.result.status !== 5) return null;

  // Extract integer solution values
  const atkCounts: Partial<Record<FeatherId, number>> = {};
  for (const f of attackEligible) {
    const val = result.result.vars[atkVarOf(f.id as FeatherId)] ?? 0;
    atkCounts[f.id as FeatherId] = Math.round(val);
  }

  const defCounts: Partial<Record<FeatherId, number>> = {};
  for (const f of defenseEligible) {
    const val = result.result.vars[defVarOf(f.id as FeatherId)] ?? 0;
    defCounts[f.id as FeatherId] = Math.round(val);
  }

  // Round-robin distribute into 5 statues per kind
  const attack = distributeRoundRobin(atkCounts);
  const defense = distributeRoundRobin(defCounts);

  // Compute poolRemaining = poolInitial − (T1 cost of chosen feathers)
  const poolRemaining: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    poolRemaining[s] = poolInitial[s] ?? 0;
  }
  for (const f of attackEligible) {
    const count = atkCounts[f.id as FeatherId] ?? 0;
    if (count === 0) continue;
    const tier1Cost = f.tiers[1]?.totalCost ?? 0;
    poolRemaining[f.set] = (poolRemaining[f.set] ?? 0) - count * tier1Cost;
  }
  for (const f of defenseEligible) {
    const count = defCounts[f.id as FeatherId] ?? 0;
    if (count === 0) continue;
    const tier1Cost = f.tiers[1]?.totalCost ?? 0;
    poolRemaining[f.set] = (poolRemaining[f.set] ?? 0) - count * tier1Cost;
  }

  return { attack, defense, poolRemaining };
}

/**
 * Round-robin distribute feather copies across 5 statues.
 *
 * Orange copies fill first (each statue needs exactly 4), then purple (each
 * statue needs exactly 1). Uniqueness holds because each feather appears ≤5
 * times, so copy i goes to statue i%5 and no two copies of the same feather
 * end up in the same statue.
 */
function distributeRoundRobin(
  counts: Partial<Record<FeatherId, number>>,
): StatueTemplate[] {
  const statues: StatueTemplate[] = Array.from({ length: 5 }, () => ({
    feathers: [],
    minTier: 1,
  }));

  const orangeList: FeatherId[] = [];
  const purpleList: FeatherId[] = [];

  for (const [id, count] of Object.entries(counts) as [FeatherId, number][]) {
    if (!count) continue;
    const def = featherById.get(id)!;
    for (let i = 0; i < count; i++) {
      if (def.rarity === 'Orange') orangeList.push(id);
      else purpleList.push(id);
    }
  }

  for (let i = 0; i < orangeList.length; i++) {
    statues[i % 5].feathers.push({ feather: orangeList[i], tier: 1 });
  }
  for (let j = 0; j < purpleList.length; j++) {
    statues[j % 5].feathers.push({ feather: purpleList[j], tier: 1 });
  }

  return statues;
}
