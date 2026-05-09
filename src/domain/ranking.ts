import type { StatKey } from './types';

// Re-exported so existing imports from presets.ts don't break immediately.
export type TemplateKind = 'attack' | 'defense';

export interface StatRanking {
  /** All 15 stats ordered by priority (index 0 = highest). One PvX variant is
   *  present depending on the pvp flag. */
  order: StatKey[];
  pvp: boolean;
  /**
   * Priority gaps between adjacent stats. gaps[i] >= 0 is the number of gap
   * steps between order[i] and order[i+1]. gaps[i]=0 means same priority.
   * Length must be order.length - 1. Defaults to all 1s if absent.
   */
  gaps?: number[];
}

/**
 * Fibonacci sequence without repeats starting at 1: 1, 2, 3, 5, 8, 13, 21, …
 * fib(0) = 1, fib(1) = 2, fib(n) = fib(n-1) + fib(n-2)
 */
export function fib(n: number): number {
  if (n <= 0) return 1;
  if (n === 1) return 2;
  let a = 1, b = 2;
  for (let i = 2; i <= n; i++) { [a, b] = [b, a + b]; }
  return b;
}

/**
 * Convert a StatRanking into solver weights using the Fibonacci sequence.
 *
 * Stats are grouped by consecutive gaps of 0. Each group is ranked from the
 * bottom (rank 0 = lowest priority). The weight for a group at rank R is
 * fib(R) = 1, 2, 3, 5, 8, 13, 21, … (no repeated values).
 * Stats within the same group share the same weight.
 */
export function weightsFromRanking(
  r: StatRanking,
): Partial<Record<StatKey, number>> {
  const n = r.order.length;
  const gaps = r.gaps ?? Array.from({ length: n - 1 }, () => 1);

  // Assign a group index (0 = highest priority) to each stat
  const groupOf: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    groupOf[i] = (gaps[i - 1] ?? 1) === 0 ? groupOf[i - 1] : groupOf[i - 1] + 1;
  }
  const numGroups = (groupOf[n - 1] ?? 0) + 1;

  const result: Partial<Record<StatKey, number>> = {};
  for (let i = 0; i < n; i++) {
    // rank from bottom: highest-priority group gets rank (numGroups - 1)
    const rank = numGroups - 1 - groupOf[i];
    result[r.order[i]] = fib(rank);
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

export type PresetName = 'Pure Offense' | 'Pure Defense' | 'Balanced';

export const PRESETS: Record<string, Omit<StatRanking, 'pvp'>> = {
  'Pure Offense': {
    order: [
      'PvEDmgBonus',
      'IgnorePDEF', 'IgnoreMDEF',
      'PDMG', 'MDMG',
      'INTDEXSTR',
      'PATK', 'MATK',
      'PvEDmgReduction',
      'PDMGReduction', 'MDMGReduction',
      'PDEF', 'MDEF',
      'HP', 'VIT',
    ],
    gaps: [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1],
  },
  'Pure Defense': {
    order: [
      'PvEDmgReduction',
      'PDMGReduction', 'MDMGReduction',
      'PDEF', 'MDEF',
      'HP', 'VIT',
      'PvEDmgBonus',
      'IgnorePDEF', 'IgnoreMDEF',
      'PDMG', 'MDMG',
      'INTDEXSTR',
      'PATK', 'MATK',
    ],
    gaps: [1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0],
  },
  'Balanced': {
    order: [
      'PvEDmgBonus', 'PvEDmgReduction',
      'IgnorePDEF', 'IgnoreMDEF',
      'PDMG', 'MDMG', 'PDMGReduction', 'MDMGReduction',
      'INTDEXSTR',
      'PATK', 'MATK', 'PDEF', 'MDEF',
      'HP', 'VIT',
    ],
    gaps: [0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1],
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
    pvp,
    ...(preset.gaps ? { gaps: preset.gaps } : {}),
  };
}

// Must reference a key that exists in PRESETS
/** Default ranking: "Balanced" preset in PvE mode. */
export const DEFAULT_RANKING: StatRanking = applyPreset('Balanced', false);
