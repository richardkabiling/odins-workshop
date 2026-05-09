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

// Full 17-key index table — both PvE and PvP variants get consistent indices.
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
  const payload = {
    inv: Object.fromEntries(
      Object.entries(state.inventory.perFeather).filter(([, v]) => (v ?? 0) > 0),
    ),
    ord,
    rat: ranking.ratio,
    ...(ranking.pvp ? { pvp: 1 } : {}),
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
      ord.length === 15 &&
      ord.every((i) => typeof i === 'number' && i >= 0 && i <= 16)
    ) {
      const order = (ord as number[]).map((i) => ALL_STAT_KEYS[i]);
      const ratio = typeof payload.rat === 'number' && payload.rat > 0 ? payload.rat : 1.5;
      ranking = { order, ratio, pvp };
    }

    return { inventory: { perFeather }, ranking };
  } catch {
    return null;
  }
}
