import type { FeatherDef, StatKey } from '../domain/types';
import type { TemplateKind } from '../domain/ranking';

/**
 * Compute per-stat normalization factors for the feather pool of a given statue type.
 *
 * The normalization factor for a stat is the maximum tier-20 value that stat
 * reaches on any single compatible feather:
 *   norm[stat] = max(tier20_value[f][stat])  for all compatible feathers f
 *
 * Compatible feathers:
 *   attack statues  → Attack + Hybrid feathers
 *   defense statues → Defense + Hybrid feathers
 *
 * Stats absent from the pool (no compatible feather provides them) are not
 * included in the returned map, so call sites use `?? 1` as the fallback.
 * Stats present but always zero use a factor of 1 (no-op) to avoid division
 * by zero.
 */
export function computeNormFactors(
  feathers: FeatherDef[],
  kind: TemplateKind,
): Partial<Record<StatKey, number>> {
  const compatible = feathers.filter(f =>
    kind === 'attack'
      ? f.type === 'Attack' || f.type === 'Hybrid'
      : f.type === 'Defense' || f.type === 'Hybrid',
  );

  const result: Partial<Record<StatKey, number>> = {};

  for (const feather of compatible) {
    const tier20 = feather.tiers[20];
    if (!tier20) continue;

    for (const [stat, val] of Object.entries(tier20.stats) as [StatKey, number][]) {
      if (!val) continue;
      if (val > (result[stat] ?? 0)) result[stat] = val;
    }
  }

  // Safety: if a stat ended up with 0 somehow, replace with 1
  for (const stat of Object.keys(result) as StatKey[]) {
    if ((result[stat] ?? 0) === 0) result[stat] = 1;
  }

  return result;
}
