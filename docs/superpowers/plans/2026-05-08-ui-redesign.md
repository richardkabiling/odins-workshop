# UI Redesign & Slider Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4 preset radio buttons with a PvE/PvP toggle + Attack/Defense budget slider, redesign statue cards with larger images and richer per-feather info, add before→after stat display, and add a total stats summary across all 10 statues.

**Architecture:** Pure logic changes (solver budget split, `computeRawStats` helper) are isolated to `scoring.ts` and `optimize.ts`; UI changes are isolated to `OptimizationControls.tsx` (new) and `ResultsView.tsx` (redesigned). `App.tsx` is updated to wire the new state shape through to both.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, glpk.js (no new dependencies)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/domain/scoring.ts` | Modify | Add exported `computeRawStats` |
| `src/solver/optimize.ts` | Modify | Add `derivePresetId`, `splitBudgets`; update `optimize()` signature |
| `src/ui/OptimizationControls.tsx` | Create | PvE/PvP toggle + Attack/Defense slider |
| `src/ui/PresetPicker.tsx` | Delete | Replaced by `OptimizationControls` |
| `src/ui/ResultsView.tsx` | Modify | Redesign `StatueCard`; add `TotalStatsSummary`; update props |
| `src/App.tsx` | Modify | Replace `presetId` state with `atkPct`+`pvp`; wire new component |
| `tests/scoring.test.ts` | Modify | Add `computeRawStats` tests |
| `tests/optimize.test.ts` | Create | Tests for `derivePresetId` and `splitBudgets` |

---

## Task 1: Add `computeRawStats` to scoring.ts

`computeRawStats` sums raw feather stats for a template — no set bonus applied. Used for the before→after display in the statue card.

**Files:**
- Modify: `src/domain/scoring.ts`
- Modify: `tests/scoring.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { featherById } from '../src/data/feathers.generated';
import { getAttackBonus } from '../src/data/setBonuses.generated';
import { computeRawStats, computeStatueStats } from '../src/domain/scoring';
import type { StatueTemplate } from '../src/domain/types';

// ... (keep existing tests)

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
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test
```

Expected: FAIL — `computeRawStats is not exported from '../src/domain/scoring'`

- [ ] **Step 3: Add `computeRawStats` to `src/domain/scoring.ts`**

Add after the existing imports and `PCT_CATEGORY_MAP`:

```ts
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/scoring.ts tests/scoring.test.ts
git commit -m "feat: add computeRawStats helper to scoring.ts"
```

---

## Task 2: Add `derivePresetId` and `splitBudgets` to optimize.ts

These two pure functions encapsulate the slider logic so they can be unit tested independently of the full optimizer.

**Files:**
- Modify: `src/solver/optimize.ts`
- Create: `tests/optimize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/optimize.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test
```

Expected: FAIL — `derivePresetId is not exported from '../src/solver/optimize'`

- [ ] **Step 3: Add the two functions to `src/solver/optimize.ts`**

Add these exports near the top of the file, after the imports:

```ts
export function derivePresetId(atkPct: number, pvp: boolean): PresetId {
  const atkFirst = atkPct >= 50;
  if (pvp) return atkFirst ? 'PvP_Atk' : 'PvP_Def';
  return atkFirst ? 'PvE_Atk' : 'PvE_Def';
}

export function splitBudgets(
  total: Partial<Record<ConversionSet, number>>,
  atkPct: number,
): { attack: Partial<Record<ConversionSet, number>>; defense: Partial<Record<ConversionSet, number>> } {
  const attack: Partial<Record<ConversionSet, number>> = {};
  const defense: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) {
    const t = total[s] ?? 0;
    const a = Math.floor(t * atkPct / 100);
    attack[s] = a;
    defense[s] = t - a;
  }
  return { attack, defense };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/solver/optimize.ts tests/optimize.test.ts
git commit -m "feat: add derivePresetId and splitBudgets helpers to optimize.ts"
```

---

## Task 3: Update `optimize()` signature to `(inventory, atkPct, pvp)`

Replace the `presetId` parameter with `atkPct: number` and `pvp: boolean`. The budget is now split between attack and defense rather than primary taking the full budget.

**Files:**
- Modify: `src/solver/optimize.ts`

- [ ] **Step 1: Replace the `optimize` function body**

Replace the entire `optimize` export in `src/solver/optimize.ts` with:

```ts
export async function optimize(
  inventory: Inventory,
  atkPct: number,
  pvp: boolean,
): Promise<OptimizeResult> {
  const primaryPresetId = derivePresetId(atkPct, pvp);
  const preset = PRESETS[primaryPresetId];
  const budgets = poolBudgets(inventory);
  const { attack: atkBudgets, defense: defBudgets } = splitBudgets(budgets, atkPct);

  const primaryKind = preset.primaryTemplate;
  const primaryBudgets = primaryKind === 'attack' ? atkBudgets : defBudgets;
  const primarySingleBudgets: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) primarySingleBudgets[s] = Math.floor((primaryBudgets[s] ?? 0) / 5);

  const primarySolutions = await precomputePerMinTier(primaryKind, primaryPresetId, primarySingleBudgets);
  const primaryAlloc = findBestAllocation(primarySolutions, primaryBudgets);

  if (!primaryAlloc) {
    return {
      ok: false,
      reason: 'infeasible',
      message: 'No feasible solution for primary template. Check that you have enough feathers (need at least 4 orange + 1 purple eligible for the chosen statue type).',
    };
  }

  const secondaryPresetId = SIBLING[primaryPresetId];
  const secondaryKind: TemplateKind = primaryKind === 'attack' ? 'defense' : 'attack';
  const remainingBudgets = subtractCost(budgets, primaryAlloc.totalCost);
  const secondarySingleBudgets: Partial<Record<ConversionSet, number>> = {};
  for (const s of SETS) secondarySingleBudgets[s] = Math.floor((remainingBudgets[s] ?? 0) / 5);

  const secondarySolutions = await precomputePerMinTier(secondaryKind, secondaryPresetId, secondarySingleBudgets);
  const secondaryAlloc = findBestAllocation(secondarySolutions, remainingBudgets);

  const emptyStatues: StatueTemplate[] = Array.from({ length: 5 }, () => ({ feathers: [], minTier: 0 }));
  const secondaryStatues = secondaryAlloc?.statues ?? emptyStatues;

  const attackStatues = primaryKind === 'attack' ? primaryAlloc.statues : secondaryStatues;
  const defenseStatues = primaryKind === 'defense' ? primaryAlloc.statues : secondaryStatues;

  const spentPerSet = { ...primaryAlloc.totalCost };
  if (secondaryAlloc) {
    for (const [s, v] of Object.entries(secondaryAlloc.totalCost) as [ConversionSet, number][]) {
      spentPerSet[s] = (spentPerSet[s] ?? 0) + v;
    }
  }

  return {
    ok: true,
    solution: {
      attack: attackStatues,
      defense: defenseStatues,
      spentPerSet,
      score: primaryAlloc.totalScore,
    },
  };
}
```

Also remove the now-unused `PresetId` import from `optimize.ts` if it is no longer used after the change (it is still used via `derivePresetId` return type, so keep it).

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all PASS (no tests call `optimize` directly yet)

- [ ] **Step 3: Commit**

```bash
git add src/solver/optimize.ts
git commit -m "feat: update optimize() to accept atkPct+pvp, split budget by slider value"
```

---

## Task 4: Build `OptimizationControls` and wire into `App`

Create the new controls component (PvE/PvP toggle + Attack/Defense slider) and update `App.tsx` to use it, replacing `PresetPicker`.

**Files:**
- Create: `src/ui/OptimizationControls.tsx`
- Modify: `src/App.tsx`
- Delete: `src/ui/PresetPicker.tsx`

- [ ] **Step 1: Create `src/ui/OptimizationControls.tsx`**

```tsx
interface Props {
  atkPct: number;
  pvp: boolean;
  onAtkPctChange: (v: number) => void;
  onPvpChange: (v: boolean) => void;
  onOptimize: () => void;
  loading: boolean;
}

export function OptimizationControls({ atkPct, pvp, onAtkPctChange, onPvpChange, onOptimize, loading }: Props) {
  const defPct = 100 - atkPct;

  function sliderLabel() {
    if (atkPct === 50) return '50% Attack · 50% Defense';
    if (atkPct > 50) return `${atkPct}% Attack · ${defPct}% Defense`;
    return `${atkPct}% Attack · ${defPct}% Defense`;
  }

  function sliderDesc() {
    if (atkPct === 50) return 'Budget split equally. Attack statues are optimized first.';
    if (atkPct > 50) return `Attack statues are optimized first with ${atkPct}% of your feather budget.`;
    return `Defense statues are optimized first with ${defPct}% of your feather budget.`;
  }

  const toggleBase: React.CSSProperties = {
    flex: 1, padding: '8px 0', textAlign: 'center', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: 'none', fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2>Optimization</h2>

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
          Content Type
        </div>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <button
            style={{ ...toggleBase, background: !pvp ? 'var(--accent)' : 'var(--surface)', color: !pvp ? '#fff' : 'var(--muted)' }}
            onClick={() => onPvpChange(false)}
          >
            PvE
          </button>
          <button
            style={{ ...toggleBase, background: pvp ? 'var(--accent)' : 'var(--surface)', color: pvp ? '#fff' : 'var(--muted)' }}
            onClick={() => onPvpChange(true)}
          >
            PvP
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
          Attack / Defense Priority
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: '#a01010', fontWeight: 600 }}>Attack</span>
          <span style={{ color: '#1010a0', fontWeight: 600 }}>Defense</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={atkPct}
          onChange={e => onAtkPctChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
        <div style={{ textAlign: 'center', fontSize: 12, marginTop: 4, fontWeight: 600 }}>
          {sliderLabel()}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
          {sliderDesc()}
        </p>
      </div>

      <button
        className="primary"
        onClick={onOptimize}
        disabled={loading}
      >
        {loading ? 'Optimizing…' : 'Optimize'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/App.tsx`**

Replace the entire file with:

```tsx
import { useState } from 'react';
import type { Inventory, Solution } from './domain/types';
import { optimize } from './solver/optimize';
import { InventoryForm } from './ui/InventoryForm';
import { OptimizationControls } from './ui/OptimizationControls';
import { ResultsView } from './ui/ResultsView';

const DEFAULT_INVENTORY: Inventory = { perFeather: {} };

export default function App() {
  const [inventory, setInventory] = useState<Inventory>(DEFAULT_INVENTORY);
  const [atkPct, setAtkPct] = useState(70);
  const [pvp, setPvp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [solvedAtkPct, setSolvedAtkPct] = useState(70);
  const [solvedPvp, setSolvedPvp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOptimize() {
    setLoading(true);
    setError(null);
    setSolution(null);
    try {
      const result = await optimize(inventory, atkPct, pvp);
      if (result.ok) {
        setSolution(result.solution);
        setSolvedAtkPct(atkPct);
        setSolvedPvp(pvp);
      } else {
        setError(result.message ?? 'No feasible solution. Check that you have enough feathers (at least 4 orange + 1 purple eligible for the chosen statue type).');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1>ROOC Feather Optimizer</h1>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          Optimizes your Ragnarok Origin Classic feather statue setup given a Tier-1 feather inventory.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <InventoryForm inventory={inventory} onChange={setInventory} />
        <div style={{ position: 'sticky', top: 16 }}>
          <div className="card">
            <OptimizationControls
              atkPct={atkPct}
              pvp={pvp}
              onAtkPctChange={setAtkPct}
              onPvpChange={setPvp}
              onOptimize={handleOptimize}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {(solution || error) && (
        <div style={{ marginTop: 32 }}>
          <ResultsView solution={solution} error={error} atkPct={solvedAtkPct} pvp={solvedPvp} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Delete `src/ui/PresetPicker.tsx`**

```bash
rm src/ui/PresetPicker.tsx
```

- [ ] **Step 4: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds with no type errors

- [ ] **Step 5: Start dev server and visually verify the controls panel**

```bash
npm run dev
```

Open http://localhost:5173. Verify:
- PvE/PvP toggle switches correctly (highlighted button changes)
- Slider moves in steps of 10 from 0 to 100
- Label and description text updates as slider moves
- Optimize button triggers loading state

- [ ] **Step 6: Commit**

```bash
git add src/ui/OptimizationControls.tsx src/App.tsx
git rm src/ui/PresetPicker.tsx
git commit -m "feat: replace PresetPicker with OptimizationControls (PvE/PvP toggle + slider)"
```

---

## Task 5: Redesign `StatueCard` in `ResultsView`

Replace the current single-section card with the 3-section layout: feathers (48px images, 1/row, badges), set bonuses (flat + pct), total stats (raw→boosted).

**Files:**
- Modify: `src/ui/ResultsView.tsx`

- [ ] **Step 1: Update `ResultsView` props and top-level structure**

Replace the entire `src/ui/ResultsView.tsx` with the following. Read the full file carefully — this is a complete rewrite:

```tsx
import type { ReactNode } from 'react';
import type { Solution, StatueTemplate, ConversionSet, StatKey } from '../domain/types';
import { featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { computeStatueStats, computeRawStats } from '../domain/scoring';
import { STAT_LABELS, ATTACK_STATS, DEFENSE_STATS, PVE_STATS, PVP_STATS } from '../data/statCategories';
import { PRESETS } from '../domain/presets';
import type { Preset } from '../domain/presets';
import { featherImages } from './featherImages';

const PCT_LABELS: Record<string, string> = {
  attack: 'Attack %',
  defense: 'Defense %',
  pve: 'PvE %',
  pvp: 'PvP %',
};

const TYPE_CLASS: Record<string, string> = {
  Attack: 'atk',
  Defense: 'def',
  Hybrid: 'hybrid',
};

const ALL_STAT_KEYS: StatKey[] = [
  ...ATTACK_STATS, ...DEFENSE_STATS, ...PVE_STATS, ...PVP_STATS, 'INTDEXSTR', 'VIT',
];

interface Props {
  solution: Solution | null;
  error: string | null;
  atkPct: number;
  pvp: boolean;
}

export function ResultsView({ solution, error, atkPct, pvp }: Props) {
  if (error) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
        {error}
      </div>
    );
  }
  if (!solution) return null;

  const atkPreset = pvp ? PRESETS.PvP_Atk : PRESETS.PvE_Atk;
  const defPreset = pvp ? PRESETS.PvP_Def : PRESETS.PvE_Def;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2>Results</h2>
        <div style={{ background: 'var(--accent)', borderRadius: 4, padding: '4px 14px', fontWeight: 700, fontSize: 18, color: '#fff' }}>
          Primary Score: {solution.score.toFixed(1)}
        </div>
      </div>

      <section>
        <h2 style={{ marginBottom: 10 }}>Attack Statues</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {solution.attack.map((t, i) => (
            <StatueCard key={i} index={i + 1} template={t} kind="attack" preset={atkPreset} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 10 }}>Defense Statues</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {solution.defense.map((t, i) => (
            <StatueCard key={i} index={i + 1} template={t} kind="defense" preset={defPreset} />
          ))}
        </div>
      </section>

      <TotalStatsSummary solution={solution} />
      <BudgetSummary spentPerSet={solution.spentPerSet} />
    </div>
  );
}

function StatueCard({
  index, template, kind, preset,
}: {
  index: number;
  template: StatueTemplate;
  kind: 'attack' | 'defense';
  preset: Preset;
}) {
  if (!template.feathers.length) {
    return (
      <div className="card" style={{ opacity: 0.5 }}>
        <h3 style={{ marginBottom: 6, fontSize: 13 }}>#{index}</h3>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>Empty (no budget)</span>
      </div>
    );
  }

  const bonus = kind === 'attack' ? getAttackBonus(template.minTier) : getDefenseBonus(template.minTier);
  const raw = computeRawStats(template);
  const boosted = computeStatueStats(template, bonus);

  const flatRows = (Object.entries(bonus.flat) as [StatKey, number][]).filter(([, v]) => v !== 0);
  const pctRows = (Object.entries(bonus.pct) as [string, number][]).filter(([, v]) => v !== 0);

  const statRows = ALL_STAT_KEYS
    .filter(k => (boosted[k] ?? 0) !== 0 || (raw[k] ?? 0) !== 0)
    .sort((a, b) => (preset.statWeights[b] ?? 0) - (preset.statWeights[a] ?? 0))
    .map(k => ({ key: k, rawVal: raw[k] ?? 0, boostedVal: boosted[k] ?? 0 }));

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, fontSize: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3>#{index}</h3>
        <span style={{ background: 'var(--surface2)', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
          T{template.minTier} set
        </span>
      </div>

      {/* Section 1: Feathers */}
      <SectionLabel>Feathers</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {template.feathers.map(({ feather, tier }) => {
          const def = featherById.get(feather)!;
          return (
            <div key={feather} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {featherImages[feather]
                ? <img src={featherImages[feather]} alt={feather} style={{ width: 48, height: 48, objectFit: 'contain', flexShrink: 0 }} />
                : <div style={{ width: 48, height: 48, background: 'var(--surface2)', borderRadius: 6, flexShrink: 0 }} />
              }
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{feather}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <span className={`badge ${def.rarity.toLowerCase()}`} style={{ fontSize: 9, padding: '1px 4px' }}>{def.rarity}</span>
                  <span className={`badge ${TYPE_CLASS[def.type]}`} style={{ fontSize: 9, padding: '1px 4px' }}>{def.type}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ background: 'var(--surface2)', borderRadius: 3, padding: '0 5px', fontSize: 11 }}>T{tier}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 10 }}>{def.tiers[tier]?.totalCost ?? 0} T1</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 2: Set Bonuses */}
      <Divider />
      <SectionLabel>Set Bonuses (T{template.minTier})</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
        {flatRows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]} flat</span>
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>+{v}</span>
          </div>
        ))}
        {pctRows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{PCT_LABELS[k] ?? k}</span>
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>+{v}%</span>
          </div>
        ))}
        {flatRows.length === 0 && pctRows.length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>No bonuses at T{template.minTier}</span>
        )}
      </div>

      {/* Section 3: Total Stats */}
      <Divider />
      <SectionLabel>Total Stats</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {statRows.map(({ key, rawVal, boostedVal }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[key]}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                {Number.isInteger(rawVal) ? rawVal : rawVal.toFixed(1)}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>→</span>
              <span style={{ fontWeight: 600 }}>
                {Number.isInteger(boostedVal) ? boostedVal : boostedVal.toFixed(1)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
      {children}
    </div>
  );
}

function Divider() {
  return <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />;
}

function TotalStatsSummary({ solution }: { solution: Solution }) {
  const totals: Partial<Record<StatKey, number>> = {};

  for (const template of solution.attack) {
    if (!template.feathers.length) continue;
    const bonus = getAttackBonus(template.minTier);
    for (const [k, v] of Object.entries(computeStatueStats(template, bonus)) as [StatKey, number][]) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  for (const template of solution.defense) {
    if (!template.feathers.length) continue;
    const bonus = getDefenseBonus(template.minTier);
    for (const [k, v] of Object.entries(computeStatueStats(template, bonus)) as [StatKey, number][]) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }

  const rows = ALL_STAT_KEYS
    .filter(k => (totals[k] ?? 0) !== 0)
    .map(k => ({ key: k, val: totals[k]! }));

  if (rows.length === 0) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 10 }}>Total Stats — All Statues</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 24px' }}>
        {rows.map(({ key, val }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[key]}</span>
            <span style={{ fontWeight: 600 }}>{Number.isInteger(val) ? val : val.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetSummary({ spentPerSet }: { spentPerSet: Partial<Record<ConversionSet, number>> }) {
  const sets = (Object.entries(spentPerSet) as [ConversionSet, number][]).filter(([, v]) => v > 0);
  if (sets.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginBottom: 8 }}>Total Budget Used</h3>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {sets.map(([setId, spent]) => (
          <div key={setId}>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{setId}: </span>
            <span style={{ fontWeight: 600 }}>{spent}</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}> T1 feathers</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/data/statCategories.ts` to export `PVE_STATS` and `PVP_STATS` individually (they are already exported — verify)**

```bash
grep -n "export" src/data/statCategories.ts
```

Expected: `ATTACK_STATS`, `DEFENSE_STATS`, `PVE_STATS`, `PVP_STATS`, `STAT_LABELS` all exported. If any are missing, add the `export` keyword.

- [ ] **Step 3: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds

- [ ] **Step 4: Visual verification**

```bash
npm run dev
```

Open http://localhost:5173. Enter some feather inventory values and click Optimize. Verify:
- Each statue card shows 3 sections separated by dividers
- Feather images are 48px, 1 per row
- Each feather row shows name, rarity badge (Orange/Purple), type badge (Attack/Defense/Hybrid), tier tag, T1 cost
- Set bonuses section shows flat bonuses and percentage bonuses
- Total stats section shows raw → boosted for each stat
- Total Stats — All Statues card appears below all statues
- Budget Used card still appears

- [ ] **Step 5: Commit**

```bash
git add src/ui/ResultsView.tsx src/data/statCategories.ts
git commit -m "feat: redesign StatueCard with 3 sections, 48px images, before→after stats, total summary"
```

---

## Task 6: Final check and cleanup

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 2: Run production build**

```bash
npm run build
```

Expected: build completes with no errors or warnings about missing exports

- [ ] **Step 3: Smoke-test the full flow in the browser**

```bash
npm run dev
```

Verify end-to-end:
1. Enter feather counts (e.g., STDN: 100, LD: 50, Purple: 30)
2. Toggle PvE → PvP, confirm label updates
3. Drag slider to 30 (defense-favored), confirm description changes to "Defense statues are optimized first with 70%..."
4. Click Optimize
5. Confirm results render with all 3 sections per card, correct badges, before→after stats, total summary

- [ ] **Step 4: Commit cleanup if any lint or build warnings were fixed**

```bash
git add -p  # stage only the specific changes
git commit -m "chore: final cleanup after UI redesign"
```
