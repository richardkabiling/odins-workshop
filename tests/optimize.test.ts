import { describe, it, expect } from 'vitest';
import {
  weightsFromRanking,
  swapPvX,
  PRESETS,
  applyPreset,
  DEFAULT_RANKING,
} from '../src/domain/ranking';
import type { StatRanking } from '../src/domain/ranking';
import type { StatKey, Inventory } from '../src/domain/types';
import { optimize } from '../src/solver/optimize';
import { featherById } from '../src/data/feathers.generated';

// ---------------------------------------------------------------------------
// A. weightsFromRanking unit tests
// ---------------------------------------------------------------------------

describe('weightsFromRanking', () => {
  it('all stats get weight 1 when all gaps are 0 (same group)', () => {
    const ranking: StatRanking = {
      order: ['PATK', 'MATK', 'PDMG', 'MDMG'] as StatKey[],
      gaps: [0, 0, 0],
      pvp: false,
    };
    const weights = weightsFromRanking(ranking);
    // Single group → rank 0 → fib(0) = 1 for all stats
    expect(weights['PATK']).toBe(1);
    expect(weights['MATK']).toBe(1);
    expect(weights['PDMG']).toBe(1);
    expect(weights['MDMG']).toBe(1);
  });

  it('produces Fibonacci weights for 3-stat order with default gaps', () => {
    const ranking: StatRanking = {
      order: ['PATK', 'MATK', 'PDMG'] as StatKey[],
      pvp: false,
      // default gaps=[1,1] → 3 separate groups
    };
    const weights = weightsFromRanking(ranking);
    // numGroups=3: PATK rank=2→fib(2)=3, MATK rank=1→fib(1)=2, PDMG rank=0→fib(0)=1
    expect(weights['PATK']).toBe(3);
    expect(weights['MATK']).toBe(2);
    expect(weights['PDMG']).toBe(1);
  });

  it('top stat always gets the highest Fibonacci weight', () => {
    const order: StatKey[] = ['IgnorePDEF', 'IgnoreMDEF', 'PATK', 'MATK', 'PDMG'];
    const ranking: StatRanking = { order, pvp: false };
    const weights = weightsFromRanking(ranking);
    // 5 separate groups → top stat gets fib(4)=8
    expect(weights[order[0]]).toBe(8);
    // Bottom stat gets fib(0)=1
    expect(weights[order[order.length - 1]]).toBe(1);
  });

  it('gaps=0 between two stats gives them equal weight', () => {
    const ranking: StatRanking = {
      order: ['PATK', 'MATK', 'PDMG'] as StatKey[],
      pvp: false,
      gaps: [1, 0], // PATK > MATK == PDMG
    };
    const weights = weightsFromRanking(ranking);
    // MATK and PDMG in same group → same weight
    expect(weights['MATK']).toBe(weights['PDMG']);
    // PATK one rank above → next Fibonacci number
    expect(weights['PATK']).toBeGreaterThan(weights['MATK']!);
  });

  it('single-stat ranking gets weight fib(0)=1', () => {
    const ranking: StatRanking = {
      order: ['PATK'] as StatKey[],
      pvp: false,
    };
    const weights = weightsFromRanking(ranking);
    expect(weights['PATK']).toBe(1);
  });

  it('two groups: top group gets fib(1)=2, bottom gets fib(0)=1', () => {
    const ranking: StatRanking = {
      order: ['PATK', 'MATK'] as StatKey[],
      pvp: false,
      gaps: [1],
    };
    const weights = weightsFromRanking(ranking);
    expect(weights['PATK']).toBe(2);
    expect(weights['MATK']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B. swapPvX unit tests
// ---------------------------------------------------------------------------

describe('swapPvX', () => {
  it('replaces PvE stats with PvP when pvp=true', () => {
    const order: StatKey[] = ['PvEDmgBonus', 'PATK', 'PvEDmgReduction'];
    const result = swapPvX(order, true);
    expect(result).toEqual(['PvPDmgBonus', 'PATK', 'PvPDmgReduction']);
  });

  it('replaces PvP stats with PvE when pvp=false', () => {
    const order: StatKey[] = ['PvPDmgBonus', 'PATK'];
    const result = swapPvX(order, false);
    expect(result).toEqual(['PvEDmgBonus', 'PATK']);
  });

  it('passes through non-PvX stats unchanged', () => {
    const order: StatKey[] = ['PATK', 'MATK', 'PDMG', 'PDEF', 'HP'];
    expect(swapPvX(order, true)).toEqual(order);
    expect(swapPvX(order, false)).toEqual(order);
  });

  it('does not modify the original array', () => {
    const order: StatKey[] = ['PvEDmgBonus', 'PATK'];
    const original = [...order];
    swapPvX(order, true);
    expect(order).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// C. checkInventory via optimize() — pre-solver checks
// ---------------------------------------------------------------------------

describe('optimize() inventory checks', () => {
  it('returns reason=inventory with diagnostics for empty inventory', async () => {
    const emptyInventory: Inventory = { perFeather: {} };
    const result = await optimize(emptyInventory, DEFAULT_RANKING);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('inventory');
      if (result.reason === 'inventory') {
        // Should have diagnostics for all 4 combinations (attack+orange, attack+purple, defense+orange, defense+purple)
        expect(result.diagnostics.length).toBe(4);
        const kinds = result.diagnostics.map(d => d.kind);
        expect(kinds).toContain('attack');
        expect(kinds).toContain('defense');
        const rarities = result.diagnostics.map(d => d.rarity);
        expect(rarities).toContain('Orange');
        expect(rarities).toContain('Purple');
      }
    }
  });

  it('returns reason=inventory with attack diagnostics when only STDN feathers present', async () => {
    // STDN set: Space (Attack, Orange), Time (Attack, Orange), Divine (Defense, Orange), Nature (Defense, Orange)
    // Orange attack-eligible in STDN: Space, Time — only 2 (need 4)
    const inventory: Inventory = {
      perFeather: {
        Space: 5,
        Time: 5,
        Divine: 5,
        Nature: 5,
        Stats: 5, // Purple Attack
      },
    };
    const result = await optimize(inventory, DEFAULT_RANKING);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('inventory');
      if (result.reason === 'inventory') {
        const attackOrangeDiag = result.diagnostics.find(
          d => d.kind === 'attack' && d.rarity === 'Orange',
        );
        expect(attackOrangeDiag).toBeDefined();
        if (attackOrangeDiag) {
          expect(attackOrangeDiag.have).toBeLessThan(attackOrangeDiag.need);
        }
      }
    }
  });

  it('does NOT return reason=inventory with sufficient feathers', async () => {
    // Orange: Space(A), Time(A), Day(A), Sky(A), Divine(D), Nature(D), Night(D), Terra(D), Light(H), Dark(H)
    // Purple: Stats(A), Soul(D), Justice(H), Grace(H), Virtue(D), Mercy(D)
    // Attack-eligible orange: Space, Time, Day, Sky, Light, Dark — 6 >= 4 ✓
    // Defense-eligible orange: Divine, Nature, Night, Terra, Light, Dark — 6 >= 4 ✓
    // Attack-eligible purple: Stats, Justice, Grace — 3 >= 1 ✓
    // Defense-eligible purple: Soul, Justice, Grace, Virtue, Mercy — 5 >= 1 ✓
    const inventory: Inventory = {
      perFeather: {
        Space: 5, Time: 5, Day: 5, Sky: 5,
        Divine: 5, Nature: 5, Night: 5, Terra: 5,
        Stats: 5, Soul: 5,
      },
    };
    const result = await optimize(inventory, DEFAULT_RANKING);
    // The important thing: inventory check should not block it
    if (!result.ok) expect(result.reason).not.toBe('inventory');
  });
});

// ---------------------------------------------------------------------------
// D. Always-feasible property test (integration, real GLPK solver)
// ---------------------------------------------------------------------------

describe('optimize() integration — full solver', () => {
  it('fills 10 statues with a good inventory', async () => {
    // Inventory values represent upgrade tokens per conversion set.
    // The pool budget is the sum of token counts across all feathers in a set.
    // 3000 tokens per orange feather × 4 feathers per set gives 12000 tokens per
    // set — well above the ~2000-token cost of tier-20 feathers across 10 statues.
    const goodInventory: Inventory = {
      perFeather: {
        Space: 3000, Time: 3000, Day: 3000, Sky: 3000,
        Divine: 3000, Nature: 3000, Night: 3000, Terra: 3000,
        Light: 3000, Dark: 3000,
        Justice: 1200, Grace: 1200, Stats: 1200, Soul: 1200, Virtue: 1200, Mercy: 1200,
      },
    };

    const result = await optimize(goodInventory, DEFAULT_RANKING);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { attack, defense } = result.solution;
      expect(attack.length).toBe(5);
      expect(defense.length).toBe(5);
      for (const statue of attack) {
        expect(statue.feathers.length).toBe(5);
      }
      for (const statue of defense) {
        expect(statue.feathers.length).toBe(5);
      }
      // Verify rarity constraint: each statue has 4 orange + 1 purple
      for (const statue of [...result.solution.attack, ...result.solution.defense]) {
        const rarities = statue.feathers.map(f => featherById.get(f.feather)?.rarity);
        const orangeCount = rarities.filter(r => r === 'Orange').length;
        const purpleCount = rarities.filter(r => r === 'Purple').length;
        expect(orangeCount).toBe(4);
        expect(purpleCount).toBe(1);
        // No duplicate feather IDs in a single statue
        const ids = statue.feathers.map(f => f.feather);
        expect(new Set(ids).size).toBe(5);
        // All tiers in valid range
        for (const f of statue.feathers) {
          expect(f.tier).toBeGreaterThanOrEqual(1);
          expect(f.tier).toBeLessThanOrEqual(20);
        }
      }
    }
  }, 30000); // 30s timeout for real GLPK
});

// ---------------------------------------------------------------------------
// E. PRESETS sanity checks
// ---------------------------------------------------------------------------

describe('PRESETS', () => {
  const EXPECTED_PRESET_NAMES = [
    'Pure Offense',
    'Pure Defense',
    'Balanced',
  ];

  it('contains all 3 expected preset names', () => {
    for (const name of EXPECTED_PRESET_NAMES) {
      expect(PRESETS).toHaveProperty(name);
    }
    expect(Object.keys(PRESETS).length).toBe(EXPECTED_PRESET_NAMES.length);
  });

  it('applyPreset("Balanced", false) order matches DEFAULT_RANKING.order', () => {
    const balanced = applyPreset('Balanced', false);
    expect(balanced.order).toEqual(DEFAULT_RANKING.order);
  });

  it('applyPreset("Balanced", true) sets pvp=true', () => {
    const balanced = applyPreset('Balanced', true);
    expect(balanced.pvp).toBe(true);
  });

  it('applyPreset("Balanced", true) order contains PvPDmgBonus (not PvEDmgBonus)', () => {
    const balanced = applyPreset('Balanced', true);
    expect(balanced.order).toContain('PvPDmgBonus');
    expect(balanced.order).not.toContain('PvEDmgBonus');
  });

  it('applyPreset("Balanced", true) order contains PvPDmgReduction (not PvEDmgReduction)', () => {
    const balanced = applyPreset('Balanced', true);
    expect(balanced.order).toContain('PvPDmgReduction');
    expect(balanced.order).not.toContain('PvEDmgReduction');
  });

  it('throws for unknown preset name', () => {
    expect(() => applyPreset('Unknown' as any, false)).toThrow();
  });
});
