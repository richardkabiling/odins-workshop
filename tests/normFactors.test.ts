import { describe, it, expect } from 'vitest';
import { computeNormFactors } from '../src/solver/normFactors';
import type { FeatherDef } from '../src/domain/types';

// ---------------------------------------------------------------------------
// Fixture feather pool
// ---------------------------------------------------------------------------

function makeTiers(tier20Stats: Partial<Record<string, number>>): FeatherDef['tiers'] {
  // Sparse array: only tier 1 and tier 20 populated
  const tiers: FeatherDef['tiers'] = [];
  tiers[1] = { tier: 1, costToNext: 1, totalCost: 0, stats: {} };
  tiers[20] = { tier: 20, costToNext: null, totalCost: 100, stats: tier20Stats as FeatherDef['tiers'][number]['stats'] };
  return tiers;
}

const FIXTURE_FEATHERS: FeatherDef[] = [
  {
    id: 'Space' as FeatherDef['id'],
    type: 'Attack',
    set: 'STDN',
    rarity: 'Orange',
    tiers: makeTiers({ PATK: 50, INTDEXSTR: 7 }),
  },
  {
    id: 'Time' as FeatherDef['id'],
    type: 'Attack',
    set: 'STDN',
    rarity: 'Orange',
    tiers: makeTiers({ PATK: 40, INTDEXSTR: 5 }),
  },
  {
    id: 'Divine' as FeatherDef['id'],
    type: 'Defense',
    set: 'LD',
    rarity: 'Orange',
    tiers: makeTiers({ HP: 210, PDEF: 30 }),
  },
  {
    id: 'Nature' as FeatherDef['id'],
    type: 'Defense',
    set: 'LD',
    rarity: 'Orange',
    tiers: makeTiers({ HP: 180, PDEF: 25 }),
  },
  {
    id: 'Justice' as FeatherDef['id'],
    type: 'Hybrid',
    set: 'Purple',
    rarity: 'Purple',
    tiers: makeTiers({ PATK: 20, HP: 100, INTDEXSTR: 3 }),
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeNormFactors', () => {
  it('returns the max tier-20 value per stat for the attack pool', () => {
    // Attack pool: Space, Time (Attack) + Justice (Hybrid)
    const factors = computeNormFactors(FIXTURE_FEATHERS, 'attack');
    expect(factors['PATK']).toBe(50);       // max(50, 40, 20)
    expect(factors['INTDEXSTR']).toBe(7);   // max(7, 5, 3)
    expect(factors['HP']).toBe(100);        // only from Justice (hybrid)
  });

  it('returns the max tier-20 value per stat for the defense pool', () => {
    // Defense pool: Divine, Nature (Defense) + Justice (Hybrid)
    const factors = computeNormFactors(FIXTURE_FEATHERS, 'defense');
    expect(factors['HP']).toBe(210);        // max(210, 180, 100)
    expect(factors['PDEF']).toBe(30);       // max(30, 25)
    expect(factors['PATK']).toBe(20);       // only from Justice (hybrid)
    expect(factors['INTDEXSTR']).toBe(3);   // only from Justice (hybrid)
  });

  it('excludes pure Attack feathers from the defense pool', () => {
    const factors = computeNormFactors(FIXTURE_FEATHERS, 'defense');
    // Space and Time are Attack-only; their higher PATK (50, 40) should not appear
    expect(factors['PATK']).toBe(20); // only Justice contributes
  });

  it('excludes pure Defense feathers from the attack pool', () => {
    const factors = computeNormFactors(FIXTURE_FEATHERS, 'attack');
    // Divine and Nature are Defense-only; their PDEF should not appear
    expect(factors['PDEF']).toBeUndefined();
  });

  it('includes Hybrid feathers in both attack and defense pools', () => {
    const atkFactors = computeNormFactors(FIXTURE_FEATHERS, 'attack');
    const defFactors = computeNormFactors(FIXTURE_FEATHERS, 'defense');
    // Justice (Hybrid) contributes HP to attack pool and PATK to defense pool
    expect(atkFactors['HP']).toBe(100);
    expect(defFactors['PATK']).toBe(20);
  });

  it('returns 1 as fallback for stats that are always zero in the pool', () => {
    const zeroFeathers: FeatherDef[] = [
      {
        id: 'Space' as FeatherDef['id'],
        type: 'Attack',
        set: 'STDN',
        rarity: 'Orange',
        tiers: makeTiers({ PATK: 0 }),
      },
    ];
    const factors = computeNormFactors(zeroFeathers, 'attack');
    // PATK is present but always 0 — the stat is absent from the map so call
    // sites get the ?? 1 fallback, which is the effective no-op normalization.
    expect(factors['PATK'] ?? 1).toBe(1);
  });
});
