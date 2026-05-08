import type { StatKey } from '../domain/types';

export const ATTACK_STATS: StatKey[] = [
  'IgnorePDEF', 'IgnoreMDEF', 'PATK', 'MATK', 'PDMG', 'MDMG',
];

export const DEFENSE_STATS: StatKey[] = [
  'PDEF', 'MDEF', 'HP', 'PDMGReduction', 'MDMGReduction',
];

export const PVE_STATS: StatKey[] = ['PvEDmgReduction', 'PvEDmgBonus'];

export const PVP_STATS: StatKey[] = ['PvPDmgReduction', 'PvPDmgBonus'];

export const STAT_LABELS: Record<StatKey, string> = {
  PATK: 'PATK',
  MATK: 'MATK',
  IgnorePDEF: 'Ignore PDEF',
  IgnoreMDEF: 'Ignore MDEF',
  PDMG: 'PDMG%',
  MDMG: 'MDMG%',
  PDEF: 'PDEF',
  MDEF: 'MDEF',
  HP: 'HP',
  PDMGReduction: 'PDMG Reduction',
  MDMGReduction: 'MDMG Reduction',
  PvEDmgBonus: 'PvE DMG Bonus',
  PvEDmgReduction: 'PvE DMG Reduction',
  PvPDmgBonus: 'PvP DMG Bonus',
  PvPDmgReduction: 'PvP DMG Reduction',
  INTDEXSTR: 'INT/DEX/STR',
  VIT: 'VIT',
};
