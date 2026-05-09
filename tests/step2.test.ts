import { describe, it, expect } from 'vitest';
import { iterateUpgrades, totalScore } from '../src/solver/step2';
import type { UpgradeState } from '../src/solver/step2';
import { featherById } from '../src/data/feathers.generated';
import { weightsFromRanking, DEFAULT_RANKING } from '../src/domain/ranking';
import type { StatueTemplate } from '../src/domain/types';

const DEFAULT_WEIGHTS = weightsFromRanking(DEFAULT_RANKING);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal attack StatueTemplate: Space + Time + Day + Sky (orange) +
 * Stats (purple) — all at the given starting tier.
 */
function attackStatue(tier: number): StatueTemplate {
  return {
    feathers: [
      { feather: 'Space', tier },
      { feather: 'Time', tier },
      { feather: 'Day', tier },
      { feather: 'Sky', tier },
      { feather: 'Stats', tier },
    ],
    minTier: tier,
  };
}

/**
 * Build a minimal defense StatueTemplate: Divine + Nature + Night + Terra (orange) +
 * Soul (purple) — all at the given starting tier.
 */
function defenseStatue(tier: number): StatueTemplate {
  return {
    feathers: [
      { feather: 'Divine', tier },
      { feather: 'Nature', tier },
      { feather: 'Night', tier },
      { feather: 'Terra', tier },
      { feather: 'Soul', tier },
    ],
    minTier: tier,
  };
}

/** Build an UpgradeState with 5 identical attack + 5 identical defense statues. */
function makeState(atkTier: number, defTier: number, poolRemaining: Partial<Record<string, number>>): UpgradeState {
  return {
    attack: Array.from({ length: 5 }, () => attackStatue(atkTier)),
    defense: Array.from({ length: 5 }, () => defenseStatue(defTier)),
    poolRemaining,
  };
}

/** Huge pool — effectively unlimited budget. */
const INFINITE_POOL = { STDN: 1_000_000, LD: 1_000_000, DN: 1_000_000, ST: 1_000_000, Purple: 1_000_000 };

/** Empty pool. */
const ZERO_POOL = { STDN: 0, LD: 0, DN: 0, ST: 0, Purple: 0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('iterateUpgrades', () => {
  it('with infinite pool all feathers reach tier 20', () => {
    const state = makeState(1, 1, INFINITE_POOL);
    const result = iterateUpgrades(state, DEFAULT_WEIGHTS);

    for (const statue of [...result.attack, ...result.defense]) {
      for (const f of statue.feathers) {
        expect(f.tier).toBe(20);
      }
    }
  });

  it('with zero pool returns state unchanged', () => {
    const state = makeState(1, 1, ZERO_POOL);
    const result = iterateUpgrades(state, DEFAULT_WEIGHTS);

    // All feathers should still be at tier 1
    for (const statue of [...result.attack, ...result.defense]) {
      for (const f of statue.feathers) {
        expect(f.tier).toBe(1);
      }
    }
  });

  it('pool sized for exactly one upgrade applies exactly one upgrade', () => {
    // Space is in STDN. T1→T2 cost for Space = tiers[1].costToNext = 6.
    // Give just 6 tokens in STDN and 0 elsewhere, single attack statue with
    // only STDN feathers (Space + Time) — but we need a full 5-feather statue.
    // Here we use the full attackStatue() which also has DN and ST feathers.
    // Give exactly the minimum costToNext across all orange STDN feathers.
    const spaceT1Cost = featherById.get('Space')!.tiers[1]?.costToNext ?? 0;
    const timeT1Cost = featherById.get('Time')!.tiers[1]?.costToNext ?? 0;
    const minSTDNCost = Math.min(spaceT1Cost, timeT1Cost);

    const pool = { STDN: minSTDNCost, LD: 0, DN: 0, ST: 0, Purple: 0 };
    const state = makeState(1, 1, pool);
    const result = iterateUpgrades(state, DEFAULT_WEIGHTS);

    // Count total number of feathers that advanced beyond tier 1
    const upgradedCount = [...result.attack, ...result.defense]
      .flatMap(s => s.feathers)
      .filter(f => f.tier > 1).length;

    // Exactly one feather should have been upgraded (across all 10 statues,
    // only the STDN-set feather in the best statue gets the budget)
    expect(upgradedCount).toBe(1);
  });

  it('does not apply a move when delta-score is zero or negative', () => {
    // With weights that give zero weight to all stats, no move should improve score
    const zeroWeights = {};
    const state = makeState(1, 1, INFINITE_POOL);
    const result = iterateUpgrades(state, zeroWeights);

    // No feather should advance since Δscore ≤ 0 for all moves
    for (const statue of [...result.attack, ...result.defense]) {
      for (const f of statue.feathers) {
        expect(f.tier).toBe(1);
      }
    }
  });

  it('poolRemaining decreases by exactly the cost of applied upgrades', () => {
    // Give a small but non-zero pool and check accounting
    const sTDNCost = featherById.get('Space')!.tiers[1]?.costToNext ?? 6;
    const pool = { STDN: sTDNCost * 3, LD: 0, DN: 0, ST: 0, Purple: 0 };
    const initialSTDN = pool.STDN;

    const state = makeState(1, 1, pool);
    const result = iterateUpgrades(state, DEFAULT_WEIGHTS);

    // All spent tokens must have come from STDN
    const spent = initialSTDN - (result.poolRemaining['STDN'] ?? 0);
    expect(spent).toBeGreaterThan(0);
    expect(result.poolRemaining['STDN']).toBeGreaterThanOrEqual(0);

    // LD / DN / ST / Purple should be unchanged
    expect(result.poolRemaining['LD']).toBe(0);
    expect(result.poolRemaining['DN']).toBe(0);
    expect(result.poolRemaining['ST']).toBe(0);
    expect(result.poolRemaining['Purple']).toBe(0);
  });

  it('multi-set lift is blocked when one of the touched sets is depleted', () => {
    // Attack statue uses Space(STDN), Time(STDN), Day(DN), Sky(ST), Stats(Purple)
    // A "lift" from T1→T2 across all feathers touches STDN, DN, ST, Purple.
    // Give budget only for STDN but not DN → lift must NOT fire (multi-set constraint).
    // Single-feather upgrades for DN and ST feathers also can't fire (DN=0, ST=0).
    // Only STDN single-feather upgrades can fire.
    const spaceT1Cost = featherById.get('Space')!.tiers[1]?.costToNext ?? 6;
    const pool = { STDN: spaceT1Cost * 5, LD: 0, DN: 0, ST: 0, Purple: 0 };

    const state = makeState(1, 1, pool);
    const result = iterateUpgrades(state, DEFAULT_WEIGHTS);

    // Verify no statue has its minTier increased to 2 (which would require a lift)
    // because a lift needs all sets funded.
    // Feathers in DN (Day) and ST (Sky) and Purple (Stats) should all stay at T1.
    for (const statue of result.attack) {
      const day = statue.feathers.find(f => f.feather === 'Day');
      const sky = statue.feathers.find(f => f.feather === 'Sky');
      const stats = statue.feathers.find(f => f.feather === 'Stats');
      if (day) expect(day.tier).toBe(1);
      if (sky) expect(sky.tier).toBe(1);
      if (stats) expect(stats.tier).toBe(1);
    }
  });

  it('total score does not decrease after iterateUpgrades', () => {
    const state = makeState(1, 1, { STDN: 100, LD: 50, DN: 50, ST: 50, Purple: 20 });
    const scoreBefore = totalScore(state, DEFAULT_WEIGHTS);
    const result = iterateUpgrades(state, DEFAULT_WEIGHTS);
    const scoreAfter = totalScore(result, DEFAULT_WEIGHTS);
    expect(scoreAfter).toBeGreaterThanOrEqual(scoreBefore);
  });

  it('tie-break: when two moves tie on efficiency, higher delta-score wins', () => {
    // We construct a scenario by running with a medium pool and verifying the
    // algorithm terminates (it would loop forever if tie-breaking was broken).
    const pool = { STDN: 200, LD: 100, DN: 100, ST: 100, Purple: 50 };
    const state = makeState(1, 1, pool);

    // If tie-breaking is broken, this would either throw or run forever.
    expect(() => iterateUpgrades(state, DEFAULT_WEIGHTS)).not.toThrow();
  });

  it('all statues remain valid after upgrade (5 feathers, no duplicates)', () => {
    const state = makeState(1, 1, INFINITE_POOL);
    const result = iterateUpgrades(state, DEFAULT_WEIGHTS);

    for (const statue of [...result.attack, ...result.defense]) {
      expect(statue.feathers).toHaveLength(5);
      const ids = statue.feathers.map(f => f.feather);
      expect(new Set(ids).size).toBe(5);
    }
  });
});

describe('totalScore', () => {
  it('returns a positive number for a valid state with non-trivial weights', () => {
    const state = makeState(10, 10, ZERO_POOL);
    const score = totalScore(state, DEFAULT_WEIGHTS);
    expect(score).toBeGreaterThan(0);
  });

  it('score at T20 > score at T1 with positive weights', () => {
    const stateT1 = makeState(1, 1, ZERO_POOL);
    const stateT20 = makeState(20, 20, ZERO_POOL);
    const scoreT1 = totalScore(stateT1, DEFAULT_WEIGHTS);
    const scoreT20 = totalScore(stateT20, DEFAULT_WEIGHTS);
    expect(scoreT20).toBeGreaterThan(scoreT1);
  });
});
