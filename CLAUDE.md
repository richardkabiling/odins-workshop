# Introduction
This is a webapp for optimizing Ragnarok Origin Classic Feather Setup

# Tech Stack
- **React** + **TypeScript** (via Vite)
- **GLPK.js** for linear programming optimization
- **Vitest** for testing

# Development

```bash
npm install       # Install dependencies
npm run dev       # Start dev server
npm run build     # Build for production (generates data + tsc + vite build)
npm run test      # Run tests
```

Generated files in `src/data/*.generated.ts` are produced by `scripts/build-data.ts` from CSVs in `data/`. Do not edit generated files manually.

# Deployment
The app is deployed to **GitHub Pages** via GitHub Actions (`.github/workflows/deploy.yml`).  
It deploys automatically on every push to `main`.

To set up GitHub Pages for the first time:
1. Go to the repo **Settings → Pages**
2. Set **Source** to **GitHub Actions**

If deployed to a subdirectory (e.g. `https://user.github.io/rooc-feather-optimizer/`), set `base` in `vite.config.ts`:
```ts
base: '/rooc-feather-optimizer/',
```

# Setup Rules
- 5 Attack Statues
- 5 Defnse Statues
- Attack Statues can contain 5 different Attack or Hybrid Feathers (4 of which must be orange and 1 purple rarity)
- Defense Statues can contain 5 different Defense or Hybrid Feathers (4 of which must be orange and 1 purple rarity)
- Feather must be unique per statue (of the 5 per statue, cannot repeat)
- Feathers can be tier'ed up (min 1 up to  max 20) with respective cost to tier up to the next one
- Attack Statues gain bonuses based on the lowest feather tier in the set (ROOC Feather Optimization - Attack Set Bonuses). Flat bonuses include PATK, MATK and PvP DMG Bonus. Percentage bonuses include Attack, PvE and PvP Percentage Bonuses.
- Defense Statues gain bonuses based on the lowest feather tier in the set (ROOC Feather Optimization - Defense Set Bonuses)
- Each feather provides various stats.
- Each statue provides stats equal to the total of the stats provided by all of its feathers increased by the set bonuses (flat and percentage increase)
- Total stat benefit is total of all stats of all feathers
- Feathers can be converted to any feather within the same set

# Attack Stats
The following stats are increased by Attack Stats Percentage Bonuses
- Ignore PDEF
- Ignore MDEF
- PATK
- MATK
- PDMG
- MDMG

# Defense Stats
The following stats are increased by Defense Stats Percentage Bonuses
- PDEF
- MDEF
- HP
- PDMG Reduction
- MDMG Reduction

# PvE Stats
The following stats are increased by PvE Stats Percentage Bonuses
- PvE DMG Reduction
- PvE DMG Bonus

# PvP Stats
The following stats are increased by PvP Stats Percentage Bonuses
- PvP DMG Reduction
- PvP DMG Bonus

# Data
- ROOC Feather Optimization - Feather Stats and Costs - contains feather types, conversion set, stat bonuses and upgrade costs
- ROOC Feather Optimization - Attack Set Bonuses - stat bonuses for attack statues based on lowest feather tier in the statue
- ROOC Feather Optimization - Defense Set Bonuses - stat bonuses for defense statuees based on lowest feather tier in the statue
- ROOC Feather Optimization - (Attack|Defense|PvE|PvP) Stats - stat categorization