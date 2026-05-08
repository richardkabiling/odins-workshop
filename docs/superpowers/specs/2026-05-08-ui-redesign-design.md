# ROOC Feather Optimizer — UI Redesign & Slider Controls

**Date:** 2026-05-08

## Overview

Redesign the results display and optimization controls to be more informative and flexible. Key changes: richer statue cards with larger feather images, a PvE/PvP toggle + Attack/Defense budget slider replacing the 4 preset radio buttons, and a total stats summary across all statues.

---

## 1. Controls Panel

**Component:** Replace `PresetPicker` with `OptimizationControls`.

### PvE / PvP Toggle
- Binary toggle: **PvE** | **PvP**
- Controls which secondary stat category is amplified by the set bonus percentage (`pve` or `pvp`)
- Replaces the PvE/PvP axis of the current 4 preset radio buttons

### Attack / Defense Slider
- Range: 0–100, step increment: 10
- Default: 70 (attack-favored)
- Label updates dynamically: e.g. "70% Attack · 30% Defense"
- At 50: equal priority (attack optimized first as a tiebreak)

### Optimize Button
- Unchanged behavior; triggers the solver with the current toggle + slider values

### Removed
- The 4 preset radio buttons (`PvE_Atk`, `PvP_Atk`, `PvE_Def`, `PvP_Def`)
- The assumption footnote ("all 5 statues use identical composition…")

---

## 2. Solver Changes

**File:** `src/solver/optimize.ts`

### Budget Split
- `atkPct` = slider value (0–100)
- `defPct` = 100 − atkPct
- Attack budget = `floor(totalBudget[set] * atkPct / 100)` per conversion set
- Defense budget = remainder (`totalBudget[set] − attackBudget[set]`)

### Priority (solve order)
- If `atkPct >= 50`: attack statues are solved first (primary), defense uses remaining budget
- If `atkPct < 50`: defense statues are solved first (primary), attack uses remaining budget
- At exactly 50: attack is solved first (deterministic tiebreak)

### Preset derivation
- The `PresetId` is derived from toggle + slider at solve time:
  - `atkPct >= 50` → primary preset is `PvE_Atk` or `PvP_Atk` depending on toggle
  - `atkPct < 50` → primary preset is `PvE_Def` or `PvP_Def` depending on toggle
- Secondary preset is always the sibling via `SIBLING[primaryPresetId]`
- No changes to `PRESETS` or `SIBLING` maps

---

## 3. Statue Card Redesign

**Component:** `StatueCard` in `ResultsView.tsx`

### Section 1 — Feathers
- One feather per row
- Each row: 48×48px image | name | Orange/Purple rarity badge | Attack/Defense/Hybrid type badge | tier tag (e.g. "T7") | T1 cost (e.g. "210 T1")

### Section 2 — Set Bonuses
- Header: "Set Bonuses (T{minTier})"
- Flat bonuses listed first: e.g. "PATK flat +120"
- Percentage bonuses listed after: e.g. "Attack % +8%", "PvE % +6%"
- Only non-zero values shown

### Section 3 — Total Stats
- Header: "Total Stats"
- Each row: stat label | raw value → boosted value
  - **Raw** = sum of feather stat values at their tiers
  - **Boosted** = raw × (1 + pct%/100) + flat (the game formula)
- Format: `1840 → 2107` (raw in muted color, arrow, boosted in bold)
- Only stats with non-zero values shown, sorted by stat weight descending

---

## 4. Total Stats Summary

**Component:** New `TotalStatsSummary` below the defense statues section.

- Single card: "Total Stats — All Statues"
- Sums the **boosted** stat values across all 10 statues (5 attack + 5 defense)
- Same row format as the per-statue stat section: stat label | total value
- Only non-zero stats shown, sorted by category order: attack stats first, then defense stats, then PvE/PvP stats, then utility (INTDEXSTR, VIT)

---

## 5. Out of Scope

- No changes to `InventoryForm`
- No changes to feather data or set bonus tables
- No changes to the ILP model (`buildModel.ts`) or GLPK wrapper
- No changes to `PRESETS`, `SIBLING`, or `scoring.ts`
