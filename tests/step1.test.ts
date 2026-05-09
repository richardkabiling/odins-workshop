import { describe, it, expect } from 'vitest';
import { solveT1Setup } from '../src/solver/step1';
import { feathers, featherById } from '../src/data/feathers.generated';
import type { Inventory, FeatherId, ConversionSet } from '../src/domain/types';
import { weightsFromRanking, DEFAULT_RANKING } from '../src/domain/ranking';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a poolInitial from a flat inventory the same way optimize.ts does. */
function poolFromInventory(inv: Inventory): Partial<Record<ConversionSet, number>> {
  const pool: Partial<Record<ConversionSet, number>> = {};
  for (const f of feathers) {
    const count = inv.perFeather[f.id as FeatherId] ?? 0;
    pool[f.set] = (pool[f.set] ?? 0) + count;
  }
  return pool;
}

/** Generous inventory: 3000 tokens per orange feather, 1200 per purple feather. */
const GENEROUS_INVENTORY: Inventory = {
  perFeather: {
    Space: 3000, Time: 3000, Day: 3000, Sky: 3000,
    Divine: 3000, Nature: 3000, Night: 3000, Terra: 3000,
    Light: 3000, Dark: 3000,
    Justice: 1200, Grace: 1200, Stats: 1200, Soul: 1200, Virtue: 1200, Mercy: 1200,
  },
};

const DEFAULT_WEIGHTS = weightsFromRanking(DEFAULT_RANKING);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('solveT1Setup', () => {
  it('produces 5 attack + 5 defense statues with generous inventory', async () => {
    const pool = poolFromInventory(GENEROUS_INVENTORY);
    const result = await solveT1Setup(pool, DEFAULT_WEIGHTS);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.attack).toHaveLength(5);
    expect(result.defense).toHaveLength(5);
  }, 30_000);

  it('each statue has exactly 4 orange + 1 purple feather', async () => {
    const pool = poolFromInventory(GENEROUS_INVENTORY);
    const result = await solveT1Setup(pool, DEFAULT_WEIGHTS);
    expect(result).not.toBeNull();
    if (!result) return;
    for (const statue of [...result.attack, ...result.defense]) {
      expect(statue.feathers).toHaveLength(5);
      const rarities = statue.feathers.map(f => featherById.get(f.feather)!.rarity);
      expect(rarities.filter(r => r === 'Orange')).toHaveLength(4);
      expect(rarities.filter(r => r === 'Purple')).toHaveLength(1);
    }
  }, 30_000);

  it('no feather is duplicated within the same statue', async () => {
    const pool = poolFromInventory(GENEROUS_INVENTORY);
    const result = await solveT1Setup(pool, DEFAULT_WEIGHTS);
    expect(result).not.toBeNull();
    if (!result) return;
    for (const statue of [...result.attack, ...result.defense]) {
      const ids = statue.feathers.map(f => f.feather);
      expect(new Set(ids).size).toBe(5);
    }
  }, 30_000);

  it('all feathers are at tier 1 after step 1', async () => {
    const pool = poolFromInventory(GENEROUS_INVENTORY);
    const result = await solveT1Setup(pool, DEFAULT_WEIGHTS);
    expect(result).not.toBeNull();
    if (!result) return;
    for (const statue of [...result.attack, ...result.defense]) {
      for (const f of statue.feathers) {
        expect(f.tier).toBe(1);
      }
    }
  }, 30_000);

  it('respects per-set pool cap: no LD feathers when LD pool is 0', async () => {
    // Remove LD set tokens (Light and Dark are both LD)
    const noLDInventory: Inventory = {
      perFeather: {
        Space: 3000, Time: 3000, Day: 3000, Sky: 3000,
        Divine: 3000, Nature: 3000, Night: 3000, Terra: 3000,
        // Light and Dark omitted → LD pool = 0
        Justice: 1200, Grace: 1200, Stats: 1200, Soul: 1200, Virtue: 1200, Mercy: 1200,
      },
    };
    const pool = poolFromInventory(noLDInventory);
    const result = await solveT1Setup(pool, DEFAULT_WEIGHTS);
    expect(result).not.toBeNull();
    if (!result) return;

    for (const statue of [...result.attack, ...result.defense]) {
      for (const f of statue.feathers) {
        const def = featherById.get(f.feather)!;
        expect(def.set).not.toBe('LD');
      }
    }
  }, 30_000);

  it('hybrid feather (Light/Dark) appears across both attack and defense statues when both kinds value it', async () => {
    const pool = poolFromInventory(GENEROUS_INVENTORY);
    // Use balanced weights — both attack and defense stats get weight
    const result = await solveT1Setup(pool, DEFAULT_WEIGHTS);
    expect(result).not.toBeNull();
    if (!result) return;

    const allFeathers = [
      ...result.attack.flatMap(s => s.feathers),
      ...result.defense.flatMap(s => s.feathers),
    ];
    const hybridIds = allFeathers
      .map(f => featherById.get(f.feather)!)
      .filter(d => d.type === 'Hybrid')
      .map(d => d.id);

    // With a balanced ranking, at least some hybrid feathers should be chosen
    expect(hybridIds.length).toBeGreaterThan(0);
  }, 30_000);

  it('poolRemaining is non-negative for all sets', async () => {
    const pool = poolFromInventory(GENEROUS_INVENTORY);
    const result = await solveT1Setup(pool, DEFAULT_WEIGHTS);
    expect(result).not.toBeNull();
    if (!result) return;
    for (const [, remaining] of Object.entries(result.poolRemaining)) {
      expect(remaining).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);

  it('returns null for an infeasible inventory (empty pool)', async () => {
    const result = await solveT1Setup({}, DEFAULT_WEIGHTS);
    expect(result).toBeNull();
  }, 30_000);
});
