/**
 * Single joint MIP with linearized set bonus — the "reference" formulation.
 *
 * One big ILP that jointly picks feather identity AND tier for all 10 statues,
 * with the set-bonus pct treated as a variable quantity driven by each statue's
 * minimum feather tier.
 *
 * ── Variable types ──────────────────────────────────────────────────────────
 *
 *   y[s][f][t] ∈ {0,1}
 *     Feather f placed in statue s at tier t.
 *     s ∈ 0..4  → attack statues; s ∈ 5..9 → defense statues.
 *     t ∈ 1..20.
 *
 *   z[s][τ] ∈ {0,1}
 *     Indicator that statue s has minTier ≥ τ (monotone: z[s,τ] ≥ z[s,τ+1]).
 *     τ ∈ 1..20.  z[s,1] = 1 always (fixed).
 *
 *   w[s][f][t][τ] ∈ [0,1]  (continuous — McCormick relaxation of y·z)
 *     Linearized product  y[s,f,t] × z[s,τ].
 *     Only introduced when τ ≥ 2 and t ≥ τ  (z[s,τ]=1 forces all feathers
 *     to tier ≥ τ, so y[s,f,t'] = 0 for t' < τ, making w = 0 there anyway).
 *
 * ── Constraints ─────────────────────────────────────────────────────────────
 *
 *   Statue composition (for each s):
 *     Σ_{f,t} y[s,f,t] = 5               (exactly 5 feathers)
 *     Σ_t     y[s,f,t] ≤ 1  ∀f            (each feather at most once)
 *     Σ_{orange f,t} y[s,f,t] = 4         (4 orange slots)
 *     Σ_{purple f,t} y[s,f,t] = 1         (1 purple slot)
 *
 *   Monotone minTier indicator (for each s):
 *     z[s,1] = 1  (fixed)
 *     z[s,τ] ≥ z[s,τ+1]  for τ = 1..19
 *
 *   Linkage — if z[s,τ]=1 then every selected feather must be at tier ≥ τ:
 *     Σ_{t < τ} y[s,f,t] + z[s,τ] ≤ 1  for each (s, f, τ ≥ 2)
 *     (If feather f is used at tier t < τ, then z[s,τ] must be 0.)
 *
 *   McCormick for w[s,f,t,τ] = y[s,f,t] · z[s,τ]  (τ ≥ 2, t ≥ τ):
 *     w ≥ y[s,f,t] + z[s,τ] − 1
 *     w ≤ y[s,f,t]
 *     w ≤ z[s,τ]
 *     w ≥ 0        (bounds)
 *
 *   Global per-set pool budget:
 *     Σ_{s,f,t: f.set=c} y[s,f,t] · totalCost(f,t) ≤ pool[c]
 *
 * ── Objective ───────────────────────────────────────────────────────────────
 *
 *   The set-bonus pct for statue s at minTier τ is decomposed as:
 *     pct(minTier_s) = pct(1)  +  Σ_{τ=2}^{20} Δpct(τ) · z[s,τ]
 *   where Δpct(τ) = pct(τ) − pct(τ−1).
 *
 *   Since z[s,1] = 1 (constant), the base objective already includes pct(1).
 *   Bilinear terms  y[s,f,t] · z[s,τ]  are replaced by the w variables:
 *
 *   Maximise:
 *     Σ_{s,f,t}     y[s,f,t]    · baseCoef(s,f,t)           [pct(1) included]
 *   + Σ_{s,f,t,τ≥2} w[s,f,t,τ] · Δpct(τ)/100 · pctStatCoef(s,f,t)
 *
 *   where:
 *     baseCoef(s,f,t)    = Σ_stat statVal(f,t,stat)·weight/norm·(1 + pct₁(stat,kind)/100)
 *     pctStatCoef(s,f,t) = Σ_{pct-affected stat} statVal(f,t,stat)·weight/norm
 *
 * ── Scale ───────────────────────────────────────────────────────────────────
 *
 *   Binary variables:  y (~2 800) + z (200) ≈ 3 000
 *   Continuous:        w (≲ 29 400)
 *   Total ≈ 32 000 variables — likely too slow for GLPK.js in-browser, but
 *   correct as the "reference" single-solve formulation.
 */

import type { ConversionSet, FeatherId, StatueTemplate, StatKey } from '../domain/types';
import type { TemplateKind } from '../domain/ranking';
import type { GlpkConstraint, GlpkModel } from './glpk';
import { feathers, featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { PCT_CATEGORY_MAP } from '../domain/scoring';
import { solve, BoundType } from './glpk';
import { totalScore, SETS } from './step2';

const MAX_FEATHER_TIER = 20;

function eligibleFeathers(kind: TemplateKind) {
  return feathers.filter(f =>
    kind === 'attack'
      ? f.type === 'Attack' || f.type === 'Hybrid'
      : f.type === 'Defense' || f.type === 'Hybrid',
  );
}

const yVar = (s: number, fId: string, t: number) => `y_${s}_${fId}_${t}`;
const zVar = (s: number, tau: number) => `z_${s}_${tau}`;
const wVar = (s: number, fId: string, t: number, tau: number) => `w_${s}_${fId}_${t}_${tau}`;

/** Marginal pct contribution of tier τ for a given set-bonus category. */
function deltaPct(kind: TemplateKind, tau: number): Record<string, number> {
  const bonusCur = kind === 'attack' ? getAttackBonus(tau) : getDefenseBonus(tau);
  const bonusPrev = kind === 'attack' ? getAttackBonus(tau - 1) : getDefenseBonus(tau - 1);
  return {
    attack: (bonusCur.pct.attack ?? 0) - (bonusPrev.pct.attack ?? 0),
    defense: (bonusCur.pct.defense ?? 0) - (bonusPrev.pct.defense ?? 0),
    pve: (bonusCur.pct.pve ?? 0) - (bonusPrev.pct.pve ?? 0),
    pvp: (bonusCur.pct.pvp ?? 0) - (bonusPrev.pct.pvp ?? 0),
  };
}

/**
 * Per-stat weighted coefficient, split into base (using pct at tier 1) and
 * the portion that is pct-sensitive (for the McCormick bilinear terms).
 */
function splitCoef(
  featherId: FeatherId,
  tier: number,
  kind: TemplateKind,
  statWeights: Partial<Record<StatKey, number>>,
  normFactors: Partial<Record<StatKey, number>>,
): { base: number; pctSensitive: Partial<Record<string, number>> } {
  const def = featherById.get(featherId)!;
  const tierData = def.tiers[tier];
  if (!tierData) return { base: 0, pctSensitive: {} };

  const bonus1 = kind === 'attack' ? getAttackBonus(1) : getDefenseBonus(1);

  let base = 0;
  const pctSensitive: Partial<Record<string, number>> = {};

  for (const [statStr, val] of Object.entries(tierData.stats) as [StatKey, number][]) {
    const weight = statWeights[statStr] ?? 0;
    if (weight === 0) continue;
    const norm = normFactors[statStr] ?? 1;
    const normalized = (val / norm) * weight;

    const pctCat = PCT_CATEGORY_MAP[statStr];
    const pct1 = pctCat ? (bonus1.pct[pctCat] ?? 0) : 0;

    // Base includes tier-1 pct
    base += normalized * (1 + pct1 / 100);

    // pctSensitive holds the stat's raw (norm-weighted) value, grouped by category
    if (pctCat) {
      pctSensitive[pctCat] = (pctSensitive[pctCat] ?? 0) + normalized;
    }
  }

  return { base, pctSensitive };
}

export interface JointMipSolution {
  attack: StatueTemplate[];
  defense: StatueTemplate[];
  poolRemaining: Partial<Record<ConversionSet, number>>;
  score: number;
}

function buildJointModel(
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Partial<Record<StatKey, number>>,
  attackNormFactors: Partial<Record<StatKey, number>>,
  defenseNormFactors: Partial<Record<StatKey, number>>,
): GlpkModel {
  const attackEligible = eligibleFeathers('attack');
  const defenseEligible = eligibleFeathers('defense');

  const objVars: { name: string; coef: number }[] = [];
  const binaryVars: string[] = [];
  const continuousUB1: string[] = []; // w vars: bounds [0,1]
  const constraints: GlpkConstraint[] = [];

  // ── y and w variables + statue-composition constraints ───────────────────

  for (let s = 0; s < 10; s++) {
    const kind: TemplateKind = s < 5 ? 'attack' : 'defense';
    const eligible = kind === 'attack' ? attackEligible : defenseEligible;
    const normFactors = kind === 'attack' ? attackNormFactors : defenseNormFactors;

    const statueAllVars: string[] = [];
    const orangeVars: string[] = [];
    const purpleVars: string[] = [];

    for (const f of eligible) {
      const featherVarsAllTiers: string[] = [];

      for (let t = 1; t <= MAX_FEATHER_TIER; t++) {
        if (!f.tiers[t]) continue;
        const yName = yVar(s, f.id, t);

        const { base, pctSensitive } = splitCoef(f.id as FeatherId, t, kind, statWeights, normFactors);

        // y contributes base coefficient (pct at tier 1 included, since z[s,1]=1)
        objVars.push({ name: yName, coef: base });
        binaryVars.push(yName);
        statueAllVars.push(yName);
        featherVarsAllTiers.push(yName);

        if (f.rarity === 'Orange') orangeVars.push(yName);
        else purpleVars.push(yName);

        // w variables for τ ≥ 2 (t ≥ τ, since z[s,τ]=1 forces tier ≥ τ)
        for (let tau = 2; tau <= t; tau++) {
          const wName = wVar(s, f.id, t, tau);
          continuousUB1.push(wName);

          // Compute objective coefficient for w:
          // Σ_{pct cat} Δpct(kind, τ)[cat] / 100 × pctSensitive[cat]
          const dp = deltaPct(kind, tau);
          let wCoef = 0;
          for (const [cat, rawVal] of Object.entries(pctSensitive) as [string, number][]) {
            wCoef += (dp[cat] ?? 0) / 100 * rawVal;
          }
          if (wCoef !== 0) {
            objVars.push({ name: wName, coef: wCoef });
          }

          const zName = zVar(s, tau);

          // McCormick: w ≥ y + z - 1
          constraints.push({
            name: `mc_lb_${wName}`,
            vars: [{ name: wName, coef: 1 }, { name: yName, coef: -1 }, { name: zName, coef: -1 }],
            bnds: { type: BoundType.LO, lb: -1, ub: 0 },
          });
          // McCormick: w ≤ y
          constraints.push({
            name: `mc_uy_${wName}`,
            vars: [{ name: wName, coef: 1 }, { name: yName, coef: -1 }],
            bnds: { type: BoundType.UP, lb: 0, ub: 0 },
          });
          // McCormick: w ≤ z
          constraints.push({
            name: `mc_uz_${wName}`,
            vars: [{ name: wName, coef: 1 }, { name: zName, coef: -1 }],
            bnds: { type: BoundType.UP, lb: 0, ub: 0 },
          });
        }
      }

      // Each feather at most once per statue
      if (featherVarsAllTiers.length > 0) {
        constraints.push({
          name: `once_s${s}_${f.id}`,
          vars: featherVarsAllTiers.map(n => ({ name: n, coef: 1 })),
          bnds: { type: BoundType.UP, lb: 0, ub: 1 },
        });
      }

      // Linkage: Σ_{t < τ} y[s,f,t] + z[s,τ] ≤ 1  for τ ≥ 2
      for (let tau = 2; tau <= MAX_FEATHER_TIER; tau++) {
        const lowTierVars = featherVarsAllTiers.filter((_, idx) => {
          // Extract tier from var name: y_s_fId_t
          const parts = featherVarsAllTiers[idx].split('_');
          const t = parseInt(parts[parts.length - 1], 10);
          return t < tau;
        });
        if (lowTierVars.length === 0) continue;

        constraints.push({
          name: `link_s${s}_${f.id}_tau${tau}`,
          vars: [
            ...lowTierVars.map(n => ({ name: n, coef: 1 })),
            { name: zVar(s, tau), coef: 1 },
          ],
          bnds: { type: BoundType.UP, lb: 0, ub: 1 },
        });
      }
    }

    // Statue composition constraints
    if (statueAllVars.length > 0) {
      constraints.push({
        name: `total_s${s}`,
        vars: statueAllVars.map(n => ({ name: n, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 5, ub: 5 },
      });
    }
    if (orangeVars.length > 0) {
      constraints.push({
        name: `orange_s${s}`,
        vars: orangeVars.map(n => ({ name: n, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 4, ub: 4 },
      });
    }
    if (purpleVars.length > 0) {
      constraints.push({
        name: `purple_s${s}`,
        vars: purpleVars.map(n => ({ name: n, coef: 1 })),
        bnds: { type: BoundType.FX, lb: 1, ub: 1 },
      });
    }
  }

  // ── z variable constraints ───────────────────────────────────────────────

  for (let s = 0; s < 10; s++) {
    // z[s,1] = 1 (fixed)
    const z1 = zVar(s, 1);
    binaryVars.push(z1);
    constraints.push({
      name: `z_fixed_s${s}`,
      vars: [{ name: z1, coef: 1 }],
      bnds: { type: BoundType.FX, lb: 1, ub: 1 },
    });

    // z[s,τ] for τ ≥ 2
    for (let tau = 2; tau <= MAX_FEATHER_TIER; tau++) {
      binaryVars.push(zVar(s, tau));
    }

    // Monotone: z[s,τ] ≥ z[s,τ+1]  ↔  z[s,τ] - z[s,τ+1] ≥ 0
    for (let tau = 1; tau < MAX_FEATHER_TIER; tau++) {
      constraints.push({
        name: `mono_s${s}_tau${tau}`,
        vars: [{ name: zVar(s, tau), coef: 1 }, { name: zVar(s, tau + 1), coef: -1 }],
        bnds: { type: BoundType.LO, lb: 0, ub: 0 },
      });
    }
  }

  // ── Global per-set pool budget ───────────────────────────────────────────

  for (const convSet of SETS) {
    const budget = poolInitial[convSet] ?? 0;
    const costVars: { name: string; coef: number }[] = [];

    for (let s = 0; s < 10; s++) {
      const kind: TemplateKind = s < 5 ? 'attack' : 'defense';
      const eligible = kind === 'attack' ? attackEligible : defenseEligible;

      for (const f of eligible.filter(ftr => ftr.set === convSet)) {
        for (let t = 1; t <= MAX_FEATHER_TIER; t++) {
          if (!f.tiers[t]) continue;
          costVars.push({ name: yVar(s, f.id, t), coef: f.tiers[t]!.totalCost });
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

  // ── Bounds for w (continuous [0,1]) ─────────────────────────────────────

  for (const wName of continuousUB1) {
    constraints.push({
      name: `wub_${wName}`,
      vars: [{ name: wName, coef: 1 }],
      bnds: { type: BoundType.DB, lb: 0, ub: 1 },
    });
  }

  return {
    name: 'joint_mip',
    objective: { direction: 2, name: 'score', vars: objVars },
    subjectTo: constraints,
    binaries: binaryVars,
  };
}

/**
 * Run the single joint MIP optimizer.
 *
 * Builds one large ILP with ~3 000 binary variables and ~29 000+ continuous
 * McCormick variables. Globally optimal (within feather-tier granularity) but
 * likely slow in GLPK.js — treat as the reference formulation.
 *
 * Returns null if GLPK reports infeasibility or an internal error occurs.
 */
export async function solveJointMip(
  poolInitial: Partial<Record<ConversionSet, number>>,
  statWeights: Partial<Record<StatKey, number>>,
  attackNormFactors: Partial<Record<StatKey, number>>,
  defenseNormFactors: Partial<Record<StatKey, number>>,
): Promise<JointMipSolution | null> {
  const model = buildJointModel(poolInitial, statWeights, attackNormFactors, defenseNormFactors);

  let result;
  try {
    result = await solve(model);
  } catch {
    return null;
  }
  if (result.result.status !== 5) return null;

  // Extract solution from y variables
  const attackEligible = eligibleFeathers('attack');
  const defenseEligible = eligibleFeathers('defense');

  const attack: StatueTemplate[] = Array.from({ length: 5 }, () => ({ feathers: [], minTier: 1 }));
  const defense: StatueTemplate[] = Array.from({ length: 5 }, () => ({ feathers: [], minTier: 1 }));
  const costSpent: Partial<Record<ConversionSet, number>> = {};

  for (let s = 0; s < 10; s++) {
    const kind: TemplateKind = s < 5 ? 'attack' : 'defense';
    const eligible = kind === 'attack' ? attackEligible : defenseEligible;
    const template = kind === 'attack' ? attack[s] : defense[s - 5];

    for (const f of eligible) {
      for (let t = 1; t <= MAX_FEATHER_TIER; t++) {
        if (!f.tiers[t]) continue;
        const name = yVar(s, f.id, t);
        if (Math.round(result.result.vars[name] ?? 0) === 1) {
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
