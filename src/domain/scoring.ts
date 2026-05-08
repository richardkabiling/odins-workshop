import type { StatKey, StatueTemplate, SetBonus } from './types';
import type { Preset } from './presets';
import { featherById } from '../data/feathers.generated';

/**
 * PCT category map: which bonus bucket (attack/defense/pve/pvp) amplifies each stat.
 * Stats with null get no pct amplification.
 */
export const PCT_CATEGORY_MAP: Record<StatKey, 'attack' | 'defense' | 'pve' | 'pvp' | null> = {
  PATK: 'attack', MATK: 'attack',
  IgnorePDEF: 'attack', IgnoreMDEF: 'attack',
  PDMG: 'attack', MDMG: 'attack',
  PDEF: 'defense', MDEF: 'defense', HP: 'defense',
  PDMGReduction: 'defense', MDMGReduction: 'defense',
  PvEDmgBonus: 'pve', PvEDmgReduction: 'pve',
  PvPDmgBonus: 'pvp', PvPDmgReduction: 'pvp',
  INTDEXSTR: null, VIT: null,
};

/** Sum raw feather stats for a template — no set bonus applied. */
export function computeRawStats(
  template: StatueTemplate,
): Partial<Record<StatKey, number>> {
  const raw: Partial<Record<StatKey, number>> = {};
  for (const { feather, tier } of template.feathers) {
    const def = featherById.get(feather)!;
    for (const [key, val] of Object.entries(def.tiers[tier]?.stats ?? {}) as [StatKey, number][]) {
      raw[key] = (raw[key] ?? 0) + val;
    }
  }
  return raw;
}

/**
 * Compute per-stat totals for a single statue instance.
 *
 * Corrected formula per game mechanics:
 *   statueStats[s] = (Σ featherStats[s]) × (1 + pct_bonus[s] / 100) + flat_bonus[s]
 *
 * The flat set bonus is added AFTER the percentage multiplication.
 */
export function computeStatueStats(
  template: StatueTemplate,
  bonus: SetBonus,
): Partial<Record<StatKey, number>> {
  const raw: Partial<Record<StatKey, number>> = {};

  for (const { feather, tier } of template.feathers) {
    const def = featherById.get(feather)!;
    for (const [key, val] of Object.entries(def.tiers[tier]?.stats ?? {}) as [StatKey, number][]) {
      raw[key] = (raw[key] ?? 0) + val;
    }
  }

  const result: Partial<Record<StatKey, number>> = {};

  // Apply pct to raw feather stats, then add flat bonus
  const allKeys = new Set<StatKey>([
    ...Object.keys(raw) as StatKey[],
    ...Object.keys(bonus.flat) as StatKey[],
  ]);

  for (const key of allKeys) {
    const cat = PCT_CATEGORY_MAP[key];
    const pct = cat ? (bonus.pct[cat] ?? 0) : 0;
    const featherTotal = (raw[key] ?? 0) * (1 + pct / 100);
    const flat = bonus.flat[key] ?? 0;
    result[key] = featherTotal + flat;
  }

  return result;
}

/** Weighted score for a single statue under a given preset. */
export function scoreStatue(
  template: StatueTemplate,
  bonus: SetBonus,
  preset: Preset,
): number {
  const stats = computeStatueStats(template, bonus);
  return Object.entries(preset.statWeights).reduce((sum, [k, w]) => {
    return sum + (stats[k as StatKey] ?? 0) * (w ?? 0);
  }, 0);
}
