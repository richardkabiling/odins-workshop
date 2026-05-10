// tests/tierEnumModel.test.ts
import { describe, it, expect } from 'vitest';
import { feathers } from '../src/data/feathers.generated';
import { weightsFromRanking, DEFAULT_RANKING } from '../src/domain/ranking';
import { computeNormFactors } from '../src/solver/normFactors';
import {
  eligibleFeathers,
  feasibilityPrecheck,
  buildScenarioModel,
  scoreCoeff,
  lpRelaxationUpperBound,
} from '../src/solver/tierEnumModel';
import { solve } from '../src/solver/glpk';

const weights = weightsFromRanking(DEFAULT_RANKING);
const normA = computeNormFactors(feathers, 'attack');
const normD = computeNormFactors(feathers, 'defense');

// Pool generous enough for most scenarios
const bigPool = { STDN: 9999, LD: 9999, DN: 9999, ST: 9999, Purple: 9999 };
// Pool with zero budget: nothing can be bought
const emptyPool = { STDN: 0, LD: 0, DN: 0, ST: 0, Purple: 0 };

describe('eligibleFeathers', () => {
  it('returns ≥4 orange and ≥1 purple for attack at tier 1', () => {
    const atk = eligibleFeathers('attack');
    expect(atk.filter(f => f.rarity === 'Orange').length).toBeGreaterThanOrEqual(4);
    expect(atk.filter(f => f.rarity === 'Purple').length).toBeGreaterThanOrEqual(1);
  });
  it('returns ≥4 orange and ≥1 purple for defense at tier 1', () => {
    const def = eligibleFeathers('defense');
    expect(def.filter(f => f.rarity === 'Orange').length).toBeGreaterThanOrEqual(4);
    expect(def.filter(f => f.rarity === 'Purple').length).toBeGreaterThanOrEqual(1);
  });
});

describe('feasibilityPrecheck', () => {
  it('returns true for low tiers with big pool', () => {
    expect(feasibilityPrecheck(1, 1, bigPool)).toBe(true);
  });
  it('returns false when pool is completely empty', () => {
    expect(feasibilityPrecheck(1, 1, emptyPool)).toBe(false);
  });
  it('returns false for very high tiers where min cost exceeds pool', () => {
    // tier 20 costs hundreds per feather; combined 10 statues × 5 feathers will exceed small pool
    expect(feasibilityPrecheck(20, 20, { STDN: 1, LD: 1, DN: 1, ST: 1, Purple: 1 })).toBe(false);
  });
  it('returns true for tier 1 with minimal pool covering cheapest feathers', () => {
    expect(feasibilityPrecheck(1, 1, { STDN: 100, LD: 100, DN: 100, ST: 100, Purple: 100 })).toBe(true);
  });
});

describe('buildScenarioModel', () => {
  it('produces a model with binary variables for ta=1, td=1', () => {
    const model = buildScenarioModel(1, 1, bigPool, weights, normA, normD);
    expect(model.binaries!.length).toBeGreaterThan(0);
    expect(model.objective.vars.length).toBeGreaterThan(0);
  });
  it('produces fewer variables for ta=10 than ta=1 (tier domain shrinks)', () => {
    const model1 = buildScenarioModel(1, 1, bigPool, weights, normA, normD);
    const model10 = buildScenarioModel(10, 10, bigPool, weights, normA, normD);
    expect(model10.binaries!.length).toBeLessThan(model1.binaries!.length);
  });
  it('produces model name encoding the scenario', () => {
    const model = buildScenarioModel(3, 7, bigPool, weights, normA, normD);
    expect(model.name).toContain('3');
    expect(model.name).toContain('7');
  });
});

describe('scoreCoeff', () => {
  it('returns a positive coefficient for any attack feather at tier 1 with nonzero weights', () => {
    const atk = eligibleFeathers('attack');
    const coef = scoreCoeff(atk[0].id as any, 1, 'attack', 1, weights, normA);
    expect(coef).toBeGreaterThan(0);
  });
  it('returns 0 for a zero-weight stat', () => {
    const zeroWeights = {};
    const atk = eligibleFeathers('attack');
    const coef = scoreCoeff(atk[0].id as any, 1, 'attack', 1, zeroWeights, normA);
    expect(coef).toBe(0);
  });
});

describe('lpRelaxationUpperBound', () => {
  // Use tier 15 so the model is small (~5 tiers per feather instead of 20)
  const smallPool = { STDN: 9999, LD: 9999, DN: 9999, ST: 9999, Purple: 9999 };

  it('returns a number for a feasible scenario at high tier (small model)', async () => {
    const model = buildScenarioModel(15, 15, smallPool, weights, normA, normD);
    const ub = await lpRelaxationUpperBound(model);
    expect(ub).not.toBeNull();
    expect(typeof ub).toBe('number');
    expect(ub!).toBeGreaterThan(0);
  }, 20000);

  it('LP bound is ≥ actual MIP solution score for the same model', async () => {
    // Use a tight pool at high tier so MIP also terminates quickly
    const pool = { STDN: 200, LD: 200, DN: 200, ST: 200, Purple: 200 };
    const model = buildScenarioModel(15, 15, pool, weights, normA, normD);

    const lpUB = await lpRelaxationUpperBound(model);
    const mipResult = await solve(model);
    if (mipResult.result.status !== 5) return; // infeasible, skip

    const mipScore = mipResult.result.z;
    // LP relaxation is an upper bound: must be >= MIP score
    expect(lpUB!).toBeGreaterThanOrEqual(mipScore - 1e-6);
  }, 30000);
});
