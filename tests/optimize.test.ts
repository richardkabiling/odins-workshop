import { describe, it, expect } from 'vitest';
import { derivePresetId, splitBudgets } from '../src/solver/optimize';

describe('derivePresetId', () => {
  it('returns PvE_Atk when atkPct=70 pvp=false', () => {
    expect(derivePresetId(70, false)).toBe('PvE_Atk');
  });
  it('returns PvE_Atk when atkPct=50 pvp=false (attack tiebreak)', () => {
    expect(derivePresetId(50, false)).toBe('PvE_Atk');
  });
  it('returns PvP_Atk when atkPct=60 pvp=true', () => {
    expect(derivePresetId(60, true)).toBe('PvP_Atk');
  });
  it('returns PvE_Def when atkPct=40 pvp=false', () => {
    expect(derivePresetId(40, false)).toBe('PvE_Def');
  });
  it('returns PvP_Def when atkPct=0 pvp=true', () => {
    expect(derivePresetId(0, true)).toBe('PvP_Def');
  });
});

describe('splitBudgets', () => {
  it('splits 100 STDN 70/30 for atkPct=70', () => {
    const { attack, defense } = splitBudgets({ STDN: 100 }, 70);
    expect(attack.STDN).toBe(70);
    expect(defense.STDN).toBe(30);
  });
  it('gives attack 0 and defense all when atkPct=0', () => {
    const { attack, defense } = splitBudgets({ STDN: 100 }, 0);
    expect(attack.STDN).toBe(0);
    expect(defense.STDN).toBe(100);
  });
  it('gives attack all and defense 0 when atkPct=100', () => {
    const { attack, defense } = splitBudgets({ STDN: 100 }, 100);
    expect(attack.STDN).toBe(100);
    expect(defense.STDN).toBe(0);
  });
  it('floors fractional split: 7 * 70% = floor(4.9) = 4', () => {
    const { attack, defense } = splitBudgets({ STDN: 7 }, 70);
    expect(attack.STDN).toBe(4);
    expect(defense.STDN).toBe(3);
  });
  it('splits multiple sets independently', () => {
    const { attack, defense } = splitBudgets({ STDN: 100, LD: 50 }, 60);
    expect(attack.STDN).toBe(60);
    expect(defense.STDN).toBe(40);
    expect(attack.LD).toBe(30);
    expect(defense.LD).toBe(20);
  });
  it('attack + defense equals total for all sets', () => {
    const total = { STDN: 83, LD: 41, DN: 27, ST: 19, Purple: 12 };
    const { attack, defense } = splitBudgets(total, 70);
    for (const s of ['STDN', 'LD', 'DN', 'ST', 'Purple'] as const) {
      expect((attack[s] ?? 0) + (defense[s] ?? 0)).toBe(total[s]);
    }
  });
});
