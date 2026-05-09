import type { StatKey } from './types';

// Re-exported so existing imports from presets.ts don't break immediately.
export type TemplateKind = 'attack' | 'defense';

export interface StatRanking {
  /** All 15 stats ordered by priority (index 0 = highest). One PvX variant is
   *  present depending on the pvp flag. */
  order: StatKey[];
  /** Geometric decay ratio: 1.0 = equal weights, 2.0 = top stat weighs 2× the
   *  next. Default 1.5. */
  ratio: number;
  pvp: boolean;
  /**
   * Priority gaps between adjacent stats. gaps[i] >= 0 is the number of geometric
   * steps between order[i] and order[i+1]. gaps[i]=0 means same priority.
   * Length must be order.length - 1. Defaults to all 1s if absent.
   */
  gaps?: number[];
}

/**
 * Convert a StatRanking into solver weights using geometric decay:
 *   weight(i) = ratio ^ (N - 1 - i)
 * where i=0 is the highest-priority stat and gets ratio^(N-1).
 */
export function weightsFromRanking(
  r: StatRanking,
): Partial<Record<StatKey, number>> {
  if (r.ratio <= 0) throw new RangeError(`StatRanking.ratio must be > 0, got ${r.ratio}`);
  const n = r.order.length;
  const gaps = r.gaps ?? Array.from({ length: n - 1 }, () => 1);
  // level[i] = cumulative gap steps from stat i to the bottom
  // weight(i) = ratio ^ level[i]; same level => same weight
  const levels: number[] = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    levels[i] = levels[i + 1] + (gaps[i] ?? 1);
  }
  const result: Partial<Record<StatKey, number>> = {};
  for (let i = 0; i < n; i++) {
    result[r.order[i]] = Math.pow(r.ratio, levels[i]);
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
    ratio: 1.7,
    order: [
      'PvEDmgBonus', 'IgnorePDEF', 'IgnoreMDEF', 'PDMG', 'MDMG',
      'PATK', 'MATK', 'INTDEXSTR',
      'PDEF', 'MDEF', 'HP', 'PDMGReduction', 'MDMGReduction',
      'PvEDmgReduction', 'VIT',
    ],
  },
  'Pure Defense': {
    ratio: 1.7,
    order: [
      'PvEDmgReduction', 'PDMGReduction', 'MDMGReduction', 'PDEF', 'MDEF', 'HP', 'VIT',
      'PvEDmgBonus', 'IgnorePDEF', 'IgnoreMDEF', 'PDMG', 'MDMG', 'PATK', 'MATK', 'INTDEXSTR',
    ],
  },
  'Balanced': {
    ratio: 1.3,
    order: [
      'PvEDmgBonus', 'PvEDmgReduction', 'IgnorePDEF', 'PDMGReduction', 'PDMG',
      'PDEF', 'MDMG', 'MDEF', 'PATK', 'HP', 'MATK', 'IgnoreMDEF',
      'MDMGReduction', 'INTDEXSTR', 'VIT',
    ],
  },
  'Glass Cannon': {
    ratio: 2.0,
    order: [
      'PvEDmgBonus', 'IgnorePDEF', 'PDMG', 'IgnoreMDEF', 'MDMG', 'PATK', 'MATK', 'INTDEXSTR',
      'PDEF', 'MDEF', 'HP', 'PDMGReduction', 'MDMGReduction', 'PvEDmgReduction', 'VIT',
    ],
  },
  'Tank': {
    ratio: 2.0,
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
    pvp,
  };
}

// Must reference a key that exists in PRESETS
/** Default ranking: "Balanced" preset in PvE mode. */
export const DEFAULT_RANKING: StatRanking = applyPreset('Balanced', false);
