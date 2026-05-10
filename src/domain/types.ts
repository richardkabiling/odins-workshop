export type ConversionSet = 'STDN' | 'LD' | 'DN' | 'ST' | 'Purple';
export type FeatherType = 'Attack' | 'Defense' | 'Hybrid';
export type Rarity = 'Orange' | 'Purple';

export type FeatherId =
  | 'Space' | 'Time' | 'Divine' | 'Nature'
  | 'Light' | 'Dark'
  | 'Day' | 'Night'
  | 'Sky' | 'Terra'
  | 'Justice' | 'Grace' | 'Stats' | 'Soul' | 'Virtue' | 'Mercy';

export type StatKey =
  | 'PATK' | 'MATK' | 'IgnorePDEF' | 'IgnoreMDEF' | 'PDMG' | 'MDMG'
  | 'PDEF' | 'MDEF' | 'HP' | 'PDMGReduction' | 'MDMGReduction'
  | 'PvEDmgBonus' | 'PvEDmgReduction'
  | 'PvPDmgBonus' | 'PvPDmgReduction'
  | 'INTDEXSTR' | 'VIT';

export interface TierData {
  tier: number;
  costToNext: number | null;
  totalCost: number;
  stats: Partial<Record<StatKey, number>>;
}

export interface FeatherDef {
  id: FeatherId;
  type: FeatherType;
  set: ConversionSet;
  rarity: Rarity;
  tiers: TierData[];
}

export interface SetBonus {
  tier: number;
  flat: Partial<Record<StatKey, number>>;
  pct: {
    attack?: number;
    defense?: number;
    pve?: number;
    pvp?: number;
  };
}

export interface FeatherInstance {
  feather: FeatherId;
  tier: number;
}

export interface StatueTemplate {
  feathers: FeatherInstance[];
  minTier: number;
}

export interface Inventory {
  perFeather: Partial<Record<FeatherId, number>>;
}

export interface Solution {
  /** 5 attack statues — may differ in tier when budget is limited */
  attack: StatueTemplate[];
  /** 5 defense statues — may differ in tier when budget is limited */
  defense: StatueTemplate[];
  spentPerSet: Partial<Record<ConversionSet, number>>;
  totalPerSet: Partial<Record<ConversionSet, number>>;
  score: number;
}

export type OptimizeStatus = 'idle' | 'running' | 'done' | 'infeasible' | 'error';

/**
 * Which optimizer algorithm to use.
 *
 *   'greedy'    — Two-step: joint T1 ILP + iterative greedy upgrade. Fastest.
 *   'tier-enum' — Tier-scenario enumeration: one joint ILP per (minTierA, minTierB)
 *                 pair, ~50–100 MIPs. Globally optimal within the enumeration.
 *   'joint-mip' — Single joint MIP with linearised set-bonus via McCormick.
 *                 ~3 000 binary + ~29 000 continuous variables. Reference formulation;
 *                 likely slow in-browser.
 */
export type OptimizerMode = 'greedy' | 'tier-enum' | 'joint-mip';

export interface InventoryDiagnostic {
  kind: 'attack' | 'defense';
  rarity: Rarity;
  need: number;          // minimum required (4 for orange, 1 for purple)
  have: number;          // how many distinct eligible feathers user has
  missing: FeatherId[];  // eligible feather IDs user has 0 of
}

export type Failure =
  | { kind: 'generic'; message: string }
  | { kind: 'inventory'; diagnostics: InventoryDiagnostic[] };

/** Progress reported by the tier-enum optimizer as scenarios are processed. */
export interface TierEnumProgress {
  /** Number of scenarios processed so far (including pruned ones). */
  done: number;
  /** Total scenarios after feasibility precheck pruning. */
  total: number;
  /** Current best score found, or null if no MIP solution has been found yet. */
  bestScore: number | null;
}

/** Options for the top-level optimize() call. Only used by tier-enum mode currently. */
export interface OptimizeOptions {
  /** Called each time a scenario completes (pruned or solved). */
  onProgress?: (p: TierEnumProgress) => void;
  /** When aborted, the optimizer stops and returns the best solution found so far. */
  signal?: AbortSignal;
}
