import type { StatKey } from './types';

export type TemplateKind = 'attack' | 'defense';

/**
 * Stat weight tiers:
 *   Offensive: PvX DMG Bonus(4) > PDMG/MDMG/IgnorePDEF/IgnoreMDEF(3) > PATK/MATK(2) > INTDEXSTR(1)
 *   Defensive: PvX DMG Reduction(5) > PDMGReduction/MDMGReduction(4) > PDEF/MDEF(3) > HP(2) > VIT(1)
 */
export const OFFENSIVE_WEIGHTS: Record<'pve' | 'pvp', Partial<Record<StatKey, number>>> = {
  pve: {
    PvEDmgBonus: 4,
    PDMG: 3, MDMG: 3, IgnorePDEF: 3, IgnoreMDEF: 3,
    PATK: 2, MATK: 2,
    INTDEXSTR: 1,
  },
  pvp: {
    PvPDmgBonus: 4,
    PDMG: 3, MDMG: 3, IgnorePDEF: 3, IgnoreMDEF: 3,
    PATK: 2, MATK: 2,
    INTDEXSTR: 1,
  },
};

export const DEFENSIVE_WEIGHTS: Record<'pve' | 'pvp', Partial<Record<StatKey, number>>> = {
  pve: {
    PvEDmgReduction: 5,
    PDMGReduction: 4, MDMGReduction: 4,
    PDEF: 3, MDEF: 3,
    HP: 2,
    VIT: 1,
  },
  pvp: {
    PvPDmgReduction: 5,
    PDMGReduction: 4, MDMGReduction: 4,
    PDEF: 3, MDEF: 3,
    HP: 2,
    VIT: 1,
  },
};

/**
 * Blends offensive and defensive stat weights based on offensivePct (0–100).
 * Both attack and defense statues use this same weight set, so the optimization
 * maximizes the total value of ALL statues weighted by the user's preference.
 *
 *   offensivePct=100 → pure offensive weights
 *   offensivePct=50  → equal blend
 *   offensivePct=0   → pure defensive weights
 */
export function makeBlendedWeights(
  offensivePct: number,
  pvp: boolean,
): Partial<Record<StatKey, number>> {
  const axis = pvp ? 'pvp' : 'pve';
  const offW = OFFENSIVE_WEIGHTS[axis];
  const defW = DEFENSIVE_WEIGHTS[axis];
  const f = offensivePct / 100;

  const allStats = new Set<StatKey>([
    ...Object.keys(offW) as StatKey[],
    ...Object.keys(defW) as StatKey[],
  ]);
  const blended: Partial<Record<StatKey, number>> = {};
  for (const stat of allStats) {
    const w = (offW[stat] ?? 0) * f + (defW[stat] ?? 0) * (1 - f);
    if (w > 0) blended[stat] = w;
  }
  return blended;
}
