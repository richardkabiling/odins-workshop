/**
 * Encodes/decodes optimizer inputs as an opaque base64 URL param.
 *
 * Format: ?s=<base64url(JSON)>
 *
 * Payload shape:
 *   {
 *     inv: { [featherId]: count },
 *     ord: number[],   // 15 indices into ALL_STAT_KEYS representing ranking.order
 *     rat: number,     // ranking.ratio
 *     pvp: 1 | undefined,
 *   }
 */

import type { FeatherId, StatKey } from '../domain/types';
import type { Inventory } from '../domain/types';
import { DEFAULT_RANKING, type StatRanking } from '../domain/ranking';

export interface UrlState {
  inventory: Inventory;
  ranking: StatRanking;
}

// Full 17-key index table (17 entries: both PvE and PvP variants) — ranking
// orders are always a 15-entry subset (DEFAULT_RANKING.order.length).
const ALL_STAT_KEYS: StatKey[] = [
  'PATK', 'MATK', 'IgnorePDEF', 'IgnoreMDEF', 'PDMG', 'MDMG',
  'PDEF', 'MDEF', 'HP', 'PDMGReduction', 'MDMGReduction',
  'PvEDmgBonus', 'PvEDmgReduction', 'PvPDmgBonus', 'PvPDmgReduction',
  'INTDEXSTR', 'VIT',
];

function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

export function encodeUrlState(state: UrlState): string {
  const { ranking } = state;
  const ord = ranking.order.map((key) => {
    const idx = ALL_STAT_KEYS.indexOf(key);
    if (idx === -1) throw new Error(`Unknown StatKey in ranking.order: "${key}"`);
    return idx;
  });
  const allOnes = !ranking.gaps || ranking.gaps.every(g => g === 1);
  const payload = {
    inv: Object.fromEntries(
      Object.entries(state.inventory.perFeather).filter(([, v]) => (v ?? 0) > 0),
    ),
    ord,
    rat: ranking.ratio,
    ...(ranking.pvp ? { pvp: 1 } : {}),
    ...(!allOnes ? { gap: ranking.gaps } : {}),
  };
  const params = new URLSearchParams();
  params.set('s', toBase64Url(JSON.stringify(payload)));
  return params.toString();
}

export function decodeUrlState(search: string): UrlState | null {
  const params = new URLSearchParams(search);
  const s = params.get('s');
  if (!s) return null;

  try {
    const payload = JSON.parse(fromBase64Url(s));

    // Inventory
    const perFeather: Partial<Record<FeatherId, number>> = {};
    for (const [id, count] of Object.entries(payload.inv ?? {}) as [FeatherId, number][]) {
      if (count > 0) perFeather[id] = count;
    }

    // pvp flag
    const pvp = payload.pvp === 1;

    // ranking — fall back to DEFAULT_RANKING on any decoding error
    let ranking: StatRanking = DEFAULT_RANKING;
    const ord: unknown = payload.ord;
    if (
      Array.isArray(ord) &&
      ord.length === DEFAULT_RANKING.order.length &&
      ord.every((i) => typeof i === 'number' && i >= 0 && i <= 16) &&
      new Set(ord).size === ord.length
    ) {
      const order = (ord as number[]).map((i) => ALL_STAT_KEYS[i]);
      const ratio = typeof payload.rat === 'number' && payload.rat > 0 ? payload.rat : 1.5;
      const gapArr: unknown = payload.gap;
      const gaps = Array.isArray(gapArr) &&
        gapArr.length === order.length - 1 &&
        gapArr.every((g) => typeof g === 'number' && g >= 0)
        ? (gapArr as number[])
        : undefined;
      ranking = { order, ratio, pvp, ...(gaps ? { gaps } : {}) };
    }

    return { inventory: { perFeather }, ranking };
  } catch {
    return null;
  }
}

// ─── Simulator URL State ──────────────────────────────────────────────────────

export type SimSlotData = { feather: FeatherId; tier: number } | null;
export type SimStatueData = SimSlotData[]; // always 5 slots

export interface SimUrlState {
  inventory: Inventory;
  attack: SimStatueData[];  // 5 statues
  defense: SimStatueData[]; // 5 statues
}

function makeEmptySimStatues(): SimStatueData[] {
  return Array.from({ length: 5 }, () => Array<SimSlotData>(5).fill(null));
}

export function encodeSimState(state: SimUrlState): string {
  const encSlot = (s: SimSlotData) => s ? [s.feather, s.tier] : null;
  const payload = {
    inv: Object.fromEntries(
      Object.entries(state.inventory.perFeather).filter(([, v]) => (v ?? 0) > 0),
    ),
    atk: state.attack.map(statue => statue.map(encSlot)),
    def: state.defense.map(statue => statue.map(encSlot)),
  };
  const params = new URLSearchParams();
  params.set('tab', 'simulate');
  params.set('sim', toBase64Url(JSON.stringify(payload)));
  return params.toString();
}

export function decodeSimState(search: string): SimUrlState | null {
  const params = new URLSearchParams(search);
  if (params.get('tab') !== 'simulate') return null;
  const sim = params.get('sim');
  if (!sim) return null;
  try {
    const payload = JSON.parse(fromBase64Url(sim));

    const perFeather: Partial<Record<FeatherId, number>> = {};
    for (const [id, count] of Object.entries(payload.inv ?? {}) as [FeatherId, number][]) {
      if (count > 0) perFeather[id] = count;
    }

    const decSlot = (s: unknown): SimSlotData => {
      if (!Array.isArray(s) || s.length !== 2 || typeof s[0] !== 'string') return null;
      return { feather: s[0] as FeatherId, tier: Number(s[1]) };
    };
    const decStatue = (arr: unknown): SimStatueData => {
      const empty: SimSlotData[] = Array(5).fill(null);
      if (!Array.isArray(arr)) return empty;
      return [...arr.slice(0, 5).map(decSlot), ...empty].slice(0, 5);
    };
    const empty5 = makeEmptySimStatues();
    const attack = Array.isArray(payload.atk)
      ? [...payload.atk.slice(0, 5).map(decStatue), ...empty5].slice(0, 5)
      : empty5;
    const defense = Array.isArray(payload.def)
      ? [...payload.def.slice(0, 5).map(decStatue), ...empty5].slice(0, 5)
      : empty5;

    return { inventory: { perFeather }, attack, defense };
  } catch {
    return null;
  }
}
