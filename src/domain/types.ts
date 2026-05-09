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

export interface InventoryDiagnostic {
  kind: 'attack' | 'defense';
  rarity: Rarity;
  need: number;          // minimum required (4 for orange, 1 for purple)
  have: number;          // how many distinct eligible feathers user has
  missing: FeatherId[];  // eligible feather IDs user has 0 of
}
