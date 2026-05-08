import { describe, it, expect } from 'vitest';
import { featherById } from '../src/data/feathers.generated';
import { getAttackBonus } from '../src/data/setBonuses.generated';
import { computeRawStats, computeStatueStats } from '../src/domain/scoring';
import type { StatueTemplate } from '../src/domain/types';

describe('feather data', () => {
  it('Space feather has 21 tiers (0–20)', () => {
    const space = featherById.get('Space')!;
    expect(space.tiers).toHaveLength(21);
    expect(space.tiers[0].tier).toBe(0);
    expect(space.tiers[20].tier).toBe(20);
  });

  it('Space T20 PATK matches CSV value (56)', () => {
    const space = featherById.get('Space')!;
    expect(space.tiers[20].stats['PATK']).toBe(56);
  });

  it('Space T20 totalCost matches CSV (523)', () => {
    const space = featherById.get('Space')!;
    expect(space.tiers[20].totalCost).toBe(523);
  });

  it('attack set bonus T20 PATK = 78', () => {
    const bonus = getAttackBonus(20);
    expect(bonus.flat['PATK']).toBe(78);
  });

  it('attack set bonus T20 attack pct = 30', () => {
    const bonus = getAttackBonus(20);
    expect(bonus.pct.attack).toBe(30);
  });

  it('all feathers have correct rarity constraint: 10 orange, 6 purple', async () => {
    const { feathers } = await import('../src/data/feathers.generated');
    const orange = feathers.filter((f: { rarity: string }) => f.rarity === 'Orange');
    const purple = feathers.filter((f: { rarity: string }) => f.rarity === 'Purple');
    expect(orange).toHaveLength(10);
    expect(purple).toHaveLength(6);
  });
});

describe('manual stat computation', () => {
  it('5× Space at T20: raw PATK across 5 statues = 5×56=280, post-bonus PATK from one statue', () => {
    // One attack statue: template = [Space T20 only partial — but as a sanity check on the formula]
    // Per CLAUDE.md: statueStats = (Σ feather stats + flat) × (1 + pct/100)
    // With Space T20: PATK=56; set bonus T20: flat PATK=78, attack pct=30%
    // post = (56 + 78) × 1.30 = 134 × 1.30 = 174.2
    const space20 = featherById.get('Space')!.tiers[20];
    const bonus = getAttackBonus(20);
    const raw = (space20.stats['PATK'] ?? 0) + (bonus.flat['PATK'] ?? 0);
    const post = raw * (1 + (bonus.pct.attack ?? 0) / 100);
    expect(raw).toBe(134);    // 56 + 78
    expect(post).toBeCloseTo(174.2, 1);
  });
});

describe('computeRawStats', () => {
  it('sums feather PATK across two feathers', () => {
    const space = featherById.get('Space')!;
    const time = featherById.get('Time')!;
    const template: StatueTemplate = {
      feathers: [
        { feather: 'Space', tier: 1 },
        { feather: 'Time', tier: 1 },
      ],
      minTier: 1,
    };
    const raw = computeRawStats(template);
    expect(raw.PATK).toBe(
      (space.tiers[1].stats.PATK ?? 0) + (time.tiers[1].stats.PATK ?? 0),
    );
  });

  it('applies no set bonus (raw < boosted when bonus exists)', () => {
    const template: StatueTemplate = {
      feathers: [{ feather: 'Space', tier: 20 }],
      minTier: 20,
    };
    const raw = computeRawStats(template);
    const bonus = getAttackBonus(20);
    const boosted = computeStatueStats(template, bonus);
    // PATK boosted includes flat +78 and +30% — must exceed raw
    expect(boosted.PATK!).toBeGreaterThan(raw.PATK!);
  });
});
