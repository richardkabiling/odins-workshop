import type { StatKey } from './types';

// Re-exported so existing imports from presets.ts don't break immediately.
export type TemplateKind = 'attack' | 'defense';

export interface StatRanking {
  /** All 15 stats ordered by priority (index 0 = highest). One PvX variant is
   *  present depending on the pvp flag. */
  order: StatKey[];
  /**
   * Step size per gap unit, in range [0.01, 1].
   * Geometric mode: base = 1 + ratio, weight(i) = (1 + ratio) ^ level[i]
   * Linear mode:    weight(i) = 1 + level[i] * ratio
   * ratio=0 → all equal weights; ratio=1 → maximum differentiation.
   */
  ratio: number;
  /** If true, use additive (linear) decay instead of multiplicative (geometric). */
  linear?: boolean;
  pvp: boolean;
  /**
   * Priority gaps between adjacent stats. gaps[i] >= 0 is the number of gap
   * steps between order[i] and order[i+1]. gaps[i]=0 means same priority.
   * Length must be order.length - 1. Defaults to all 1s if absent.
   */
  gaps?: number[];
}

/**
 * Convert a StatRanking into solver weights.
 *
 * Geometric (default): weight(i) = (1 + ratio) ^ level[i]
 * Linear:              weight(i) = 1 + level[i] * ratio
 *
 * level[i] = cumulative gap steps from stat i to the lowest-priority stat.
 * Stats sharing the same level get equal weight.
 */
export function weightsFromRanking(
  r: StatRanking,
): Partial<Record<StatKey, number>> {
  if (r.ratio < 0) throw new RangeError(`StatRanking.ratio must be >= 0, got ${r.ratio}`);
  const n = r.order.length;
  const gaps = r.gaps ?? Array.from({ length: n - 1 }, () => 1);
  const levels: number[] = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    levels[i] = levels[i + 1] + (gaps[i] ?? 1);
  }
  const result: Partial<Record<StatKey, number>> = {};
  for (let i = 0; i < n; i++) {
    result[r.order[i]] = r.linear
      ? 1 + levels[i] * r.ratio
      : Math.pow(1 + r.ratio, levels[i]);
  }
  return result;
}

const PVE_TO_PVP: Partial<Record<StatKey, StatKey>> = {
  PvEDmgBonus: 'PvPDmgBonus',
  PvEDmgReduction: 'PvPDmgReduction',
};

const PVP_TO_PVE: Partial<Record<StatKey, StatKey>> = {
  PvPDmgBonus: 'PvEDmgBonus',
  PvPDmgReduction: 'PvEDmgReduction',
};

/**
 * Return a new order array with PvE↔PvP stat variants swapped to match pvp.
 *   pvp=true  → replace PvEDmgBonus→PvPDmgBonus, PvEDmgReduction→PvPDmgReduction
 *   pvp=false → replace PvPDmgBonus→PvEDmgBonus, PvPDmgReduction→PvEDmgReduction
 */
export function swapPvX(order: StatKey[], pvp: boolean): StatKey[] {
  const map = pvp ? PVE_TO_PVP : PVP_TO_PVE;
  return order.map((s) => (map[s] as StatKey | undefined) ?? s);
}

// ---------------------------------------------------------------------------
// Named presets (canonical order uses PvE variants; swapPvX handles pvp mode)
// ---------------------------------------------------------------------------

export type PresetName = 'Pure Offense' | 'Pure Defense' | 'Balanced' | 'Glass Cannon' | 'Tank';

export const PRESETS: Record<string, Omit<StatRanking, 'pvp'>> = {
  'Pure Offense': {
    ratio: 0.7,
    linear: false,
    order: [
      'PvEDmgBonus', 'IgnorePDEF', 'IgnoreMDEF', 'PDMG', 'MDMG',
      'PATK', 'MATK', 'INTDEXSTR',
      'PDEF', 'MDEF', 'HP', 'PDMGReduction', 'MDMGReduction',
      'PvEDmgReduction', 'VIT',
    ],
  },
  'Pure Defense': {
    ratio: 0.7,
    linear: false,
    order: [
      'PvEDmgReduction', 'PDMGReduction', 'MDMGReduction', 'PDEF', 'MDEF', 'HP', 'VIT',
      'PvEDmgBonus', 'IgnorePDEF', 'IgnoreMDEF', 'PDMG', 'MDMG', 'PATK', 'MATK', 'INTDEXSTR',
    ],
  },
  'Balanced': {
    ratio: 0.3,
    linear: false,
    order: [
      'PvEDmgBonus', 'PvEDmgReduction', 'IgnorePDEF', 'PDMGReduction', 'PDMG',
      'PDEF', 'MDMG', 'MDEF', 'PATK', 'HP', 'MATK', 'IgnoreMDEF',
      'MDMGReduction', 'INTDEXSTR', 'VIT',
    ],
  },
  'Glass Cannon': {
    ratio: 1.0,
    linear: false,
    order: [
      'PvEDmgBonus', 'IgnorePDEF', 'PDMG', 'IgnoreMDEF', 'MDMG', 'PATK', 'MATK', 'INTDEXSTR',
      'PDEF', 'MDEF', 'HP', 'PDMGReduction', 'MDMGReduction', 'PvEDmgReduction', 'VIT',
    ],
  },
  'Tank': {
    ratio: 1.0,
    linear: false,
    order: [
      'PvEDmgReduction', 'PDMGReduction', 'MDMGReduction', 'HP', 'PDEF', 'MDEF', 'VIT',
      'PvEDmgBonus', 'IgnorePDEF', 'PDMG', 'IgnoreMDEF', 'MDMG', 'PATK', 'MATK', 'INTDEXSTR',
    ],
  },
};

/**
 * Build a StatRanking from a named preset, honouring the current pvp flag.
 * swapPvX is called so the order contains the correct PvX variant.
 */
export function applyPreset(name: PresetName, pvp: boolean): StatRanking {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown preset: "${name}"`);
  }
  return {
    order: swapPvX(preset.order, pvp),
    ratio: preset.ratio,
    linear: preset.linear ?? false,
    pvp,
  };
}

// Must reference a key that exists in PRESETS
/** Default ranking: "Balanced" preset in PvE mode. */
export const DEFAULT_RANKING: StatRanking = applyPreset('Balanced', false);
