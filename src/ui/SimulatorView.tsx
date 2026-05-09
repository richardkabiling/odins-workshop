import { useState, useEffect } from 'react';
import type { FeatherId, ConversionSet, StatKey, Inventory, FeatherDef } from '../domain/types';
import { feathers, featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { computeStatueStats, computeRawStats, PCT_CATEGORY_MAP } from '../domain/scoring';
import { STAT_LABELS, ATTACK_STATS, DEFENSE_STATS, PVE_STATS, PVP_STATS } from '../data/statCategories';
import { featherImages } from './featherImages';
import { RarityDot, TypeChip } from './FeatherBadges';
import { FeatherTooltipContent, TierTooltipContent, WithTooltip } from './FeatherTooltip';
import { InventoryForm } from './InventoryForm';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SimSlot = { feather: FeatherId; tier: number } | null;
export type SimStatue = SimSlot[]; // always length 5

interface PickerTarget {
  kind: 'attack' | 'defense';
  statueIdx: number;
  slotIdx: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROMAN = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

const ALL_STAT_KEYS: StatKey[] = [
  ...ATTACK_STATS, ...DEFENSE_STATS, ...PVE_STATS, ...PVP_STATS, 'INTDEXSTR', 'VIT',
];

const PCT_LABELS: Record<string, string> = {
  attack: 'Attack %', defense: 'Defense %', pve: 'PvE %', pvp: 'PvP %',
};

const SETS: ConversionSet[] = ['STDN', 'LD', 'DN', 'ST', 'Purple'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function featherDisplayName(id: string) {
  return id === 'Stats' ? 'Valor/Faith/Glory' : id;
}

export function makeEmptyStatues(): SimStatue[] {
  return Array.from({ length: 5 }, () => Array<SimSlot>(5).fill(null));
}

function statueTemplate(statue: SimStatue) {
  const filled = statue.filter((s): s is NonNullable<SimSlot> => s !== null);
  if (!filled.length) return null;
  return {
    feathers: filled.map(s => ({ feather: s.feather, tier: s.tier })),
    minTier: Math.min(...filled.map(s => s.tier)),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  inventory: Inventory;
  onInventoryChange: (inv: Inventory) => void;
  onInventoryClear: () => void;
  invFormKey: number;
  attackStatues: SimStatue[];
  defenseStatues: SimStatue[];
  onAttackChange: (next: SimStatue[]) => void;
  onDefenseChange: (next: SimStatue[]) => void;
}

export function SimulatorView({
  inventory, onInventoryChange, onInventoryClear, invFormKey,
  attackStatues, defenseStatues, onAttackChange, onDefenseChange,
}: Props) {
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [pickerFeather, setPickerFeather] = useState<FeatherId | null>(null);
  const [pickerTier, setPickerTier] = useState<number>(1);
  const [ignoreLimits, setIgnoreLimits] = useState(false);

  // ── Statue mutation helpers ─────────────────────────────────────────────

  function getStatues(kind: 'attack' | 'defense') {
    return kind === 'attack' ? attackStatues : defenseStatues;
  }
  function setStatues(kind: 'attack' | 'defense', next: SimStatue[]) {
    kind === 'attack' ? onAttackChange(next) : onDefenseChange(next);
  }

  function openPicker(kind: 'attack' | 'defense', statueIdx: number, slotIdx: number) {
    const slot = getStatues(kind)[statueIdx][slotIdx];
    setPickerTarget({ kind, statueIdx, slotIdx });
    setPickerFeather(slot?.feather ?? null);
    setPickerTier(slot?.tier ?? 1);
  }

  function assign(feather: FeatherId, tier: number) {
    if (!pickerTarget) return;
    const { kind, statueIdx, slotIdx } = pickerTarget;
    setStatues(kind, getStatues(kind).map((s, si) =>
      si !== statueIdx ? s : s.map((slot, li) => li === slotIdx ? { feather, tier } : slot),
    ));
  }

  function removeSlot() {
    if (!pickerTarget) return;
    const { kind, statueIdx, slotIdx } = pickerTarget;
    setStatues(kind, getStatues(kind).map((s, si) =>
      si !== statueIdx ? s : s.map((slot, li) => li === slotIdx ? null : slot),
    ));
    setPickerTarget(null);
  }

  // ── Budget calculation ──────────────────────────────────────────────────

  const spentPerSet: Partial<Record<ConversionSet, number>> = {};
  for (const statue of [...attackStatues, ...defenseStatues]) {
    for (const slot of statue) {
      if (!slot) continue;
      const def = featherById.get(slot.feather);
      if (!def) continue;
      const cost = def.tiers[slot.tier]?.totalCost ?? 0;
      spentPerSet[def.set] = (spentPerSet[def.set] ?? 0) + cost;
    }
  }

  const inventoryPool: Partial<Record<ConversionSet, number>> = {};
  for (const [fid, count] of Object.entries(inventory.perFeather) as [FeatherId, number][]) {
    if (!count) continue;
    const def = featherById.get(fid);
    if (!def) continue;
    inventoryPool[def.set] = (inventoryPool[def.set] ?? 0) + count;
  }

  // Spent excluding the slot currently being edited in the picker
  const spentExcludingSlot: Partial<Record<ConversionSet, number>> = { ...spentPerSet };
  if (pickerTarget && pickerFeather) {
    const slotDef = featherById.get(pickerFeather);
    if (slotDef) {
      const slotCost = slotDef.tiers[pickerTier]?.totalCost ?? 0;
      spentExcludingSlot[slotDef.set] = Math.max(0, (spentExcludingSlot[slotDef.set] ?? 0) - slotCost);
    }
  }

  function wouldExceedBudget(featherId: FeatherId, tier: number): boolean {
    if (ignoreLimits) return false;
    const def = featherById.get(featherId);
    if (!def) return false;
    const pool = inventoryPool[def.set] ?? 0;
    if (pool === 0) return false; // no inventory entered — no restriction
    const cost = def.tiers[tier]?.totalCost ?? 0;
    return (spentExcludingSlot[def.set] ?? 0) + cost > pool;
  }

  // ── Overall totals ──────────────────────────────────────────────────────

  const overallTotals: Partial<Record<StatKey, number>> = {};
  for (const statue of attackStatues) {
    const tpl = statueTemplate(statue);
    if (!tpl) continue;
    const stats = computeStatueStats(tpl, getAttackBonus(tpl.minTier));
    for (const [k, v] of Object.entries(stats) as [StatKey, number][]) {
      overallTotals[k] = (overallTotals[k] ?? 0) + v;
    }
  }
  for (const statue of defenseStatues) {
    const tpl = statueTemplate(statue);
    if (!tpl) continue;
    const stats = computeStatueStats(tpl, getDefenseBonus(tpl.minTier));
    for (const [k, v] of Object.entries(stats) as [StatKey, number][]) {
      overallTotals[k] = (overallTotals[k] ?? 0) + v;
    }
  }

  // ── Picker computed state ───────────────────────────────────────────────

  const eligibleTypes = pickerTarget
    ? (pickerTarget.kind === 'attack' ? ['Attack', 'Hybrid'] : ['Defense', 'Hybrid'])
    : [];

  const usedInStatue: Set<FeatherId> = pickerTarget
    ? new Set(
        getStatues(pickerTarget.kind)[pickerTarget.statueIdx]
          .filter((s, i): s is NonNullable<SimSlot> => s !== null && i !== pickerTarget.slotIdx)
          .map(s => s.feather),
      )
    : new Set();

  const groupedFeathers: { label: string; items: FeatherDef[] }[] = [];
  const attackEligible = feathers.filter(f => eligibleTypes.includes(f.type) && f.type === 'Attack');
  const defenseEligible = feathers.filter(f => eligibleTypes.includes(f.type) && f.type === 'Defense');
  const hybridEligible = feathers.filter(f => eligibleTypes.includes(f.type) && f.type === 'Hybrid');
  if (attackEligible.length) groupedFeathers.push({ label: 'Attack', items: attackEligible });
  if (defenseEligible.length) groupedFeathers.push({ label: 'Defense', items: defenseEligible });
  if (hybridEligible.length) groupedFeathers.push({ label: 'Hybrid', items: hybridEligible });

  // ── Render ──────────────────────────────────────────────────────────────

  const hasTotals = ALL_STAT_KEYS.some(k => (overallTotals[k] ?? 0) !== 0);
  const hasSpent = Object.keys(spentPerSet).length > 0;
  const anyExcess = SETS.some(setId => (spentPerSet[setId] ?? 0) > (inventoryPool[setId] ?? 0) && (spentPerSet[setId] ?? 0) > 0);

  useEffect(() => {
    if (anyExcess) setIgnoreLimits(true);
  }, [anyExcess]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Inventory */}
      <InventoryForm
        key={invFormKey}
        inventory={inventory}
        onChange={onInventoryChange}
        onClear={onInventoryClear}
      />

      {/* Budget Used */}
      {(() => {
        return (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3>Total Budget Used</h3>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                color: anyExcess && ignoreLimits ? 'var(--danger)' : 'var(--muted)',
                cursor: anyExcess ? 'not-allowed' : 'pointer',
                userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={ignoreLimits}
                  disabled={anyExcess}
                  onChange={e => setIgnoreLimits(e.target.checked)}
                  style={{ cursor: anyExcess ? 'not-allowed' : 'pointer', accentColor: 'var(--accent)' }}
                />
                Ignore inventory limits{anyExcess ? ' (excess — remove feathers to disable)' : ''}
              </label>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              {!hasSpent && Object.keys(inventoryPool).length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>No feathers assigned yet.</span>
              )}
              {SETS.map(setId => {
                const spent = spentPerSet[setId] ?? 0;
                const avail = inventoryPool[setId] ?? 0;
                if (spent === 0 && avail === 0) return null;
                const over = spent > avail && spent > 0;
                return (
                  <div key={setId}>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{setId}: </span>
                    <span style={{ fontWeight: 600, color: over ? 'var(--danger)' : undefined }}>{spent}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}> / {avail} T1 feathers</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Attack Statues */}
      <section>
        <h2 style={{ marginBottom: 10 }}>Attack Statues</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {attackStatues.map((statue, i) => (
            <StatueSimCard
              key={i}
              index={i + 1}
              kind="attack"
              statue={statue}
              selectedSlot={
                pickerTarget?.kind === 'attack' && pickerTarget.statueIdx === i
                  ? pickerTarget.slotIdx
                  : null
              }
              onSlotClick={slotIdx => openPicker('attack', i, slotIdx)}
            />
          ))}
        </div>
      </section>

      {/* Defense Statues */}
      <section>
        <h2 style={{ marginBottom: 10 }}>Defense Statues</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {defenseStatues.map((statue, i) => (
            <StatueSimCard
              key={i}
              index={i + 1}
              kind="defense"
              statue={statue}
              selectedSlot={
                pickerTarget?.kind === 'defense' && pickerTarget.statueIdx === i
                  ? pickerTarget.slotIdx
                  : null
              }
              onSlotClick={slotIdx => openPicker('defense', i, slotIdx)}
            />
          ))}
        </div>
      </section>

      {/* Total Stats */}
      {hasTotals && (
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Total Stats — All Statues</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 24px' }}>
            {ALL_STAT_KEYS.filter(k => (overallTotals[k] ?? 0) !== 0).map(k => {
              const v = overallTotals[k]!;
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}</span>
                  <span style={{ fontWeight: 600 }}>{Number.isInteger(v) ? v : v.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Feather Picker Modal ─────────────────────────────────────────── */}
      {pickerTarget && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setPickerTarget(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }}
          />

          {/* Dialog */}
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 201,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
            width: 680,
            maxWidth: '95vw',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 15 }}>
                {pickerTarget.kind === 'attack' ? 'Attack' : 'Defense'} Statue #{pickerTarget.statueIdx + 1}
                {' '}— Slot {pickerTarget.slotIdx + 1}
              </h3>
              <button
                onClick={() => setPickerTarget(null)}
                style={{ background: 'none', fontSize: 20, color: 'var(--muted)', padding: '0 6px', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* Budget mini-summary */}
            {Object.keys(inventoryPool).length > 0 && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '6px 10px', background: 'var(--surface2)', borderRadius: 6, fontSize: 12 }}>
                {SETS.map(setId => {
                  const pool = inventoryPool[setId] ?? 0;
                  if (pool === 0) return null;
                  const selectedFeatherSet = pickerFeather ? featherById.get(pickerFeather)?.set : undefined;
                  const spent = selectedFeatherSet === setId
                    ? (spentExcludingSlot[setId] ?? 0) + (featherById.get(pickerFeather!)?.tiers[pickerTier]?.totalCost ?? 0)
                    : (spentPerSet[setId] ?? 0);
                  const over = spent > pool;
                  return (
                    <span key={setId}>
                      <span style={{ color: 'var(--muted)' }}>{setId}: </span>
                      <span style={{ fontWeight: 700, color: over ? 'var(--danger)' : 'var(--green)' }}>{spent}</span>
                      <span style={{ color: 'var(--muted)' }}> / {pool} T1</span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Body */}
            <div style={{ display: 'flex', gap: 16, minHeight: 0, flex: 1, overflow: 'hidden' }}>

              {/* Left: feather list grouped by type */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {groupedFeathers.map(({ label, items }) => (
                  <div key={label}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                      textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6,
                    }}>
                      {label}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {items.map(f => {
                        const fid = f.id as FeatherId;
                        const isSelected = pickerFeather === fid;
                        const isUsed = usedInStatue.has(fid);
                        const overBudget = !isSelected && wouldExceedBudget(fid, pickerTier);
                        const disabled = isUsed || overBudget;
                        const featherBtn = (
                          <button
                            key={fid}
                            disabled={disabled}
                            onClick={() => {
                              setPickerFeather(fid);
                              assign(fid, pickerTier);
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 10px', borderRadius: 6,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              background: isSelected ? 'var(--accent)' : 'var(--surface2)',
                              color: isSelected ? '#fff' : disabled ? 'var(--muted)' : 'var(--text)',
                              border: isSelected
                                ? '2px solid var(--accent)'
                                : overBudget ? '2px solid var(--danger)'
                                : '2px solid transparent',
                              opacity: disabled ? 0.4 : 1,
                              textAlign: 'left', fontFamily: 'inherit', fontSize: 12,
                              transition: 'background 0.1s',
                              width: '100%',
                            }}
                          >
                            {/* Image with tier overlay */}
                            <div style={{ position: 'relative', flexShrink: 0, width: 44, height: 44 }}>
                              {featherImages[f.id]
                                ? <img src={featherImages[f.id]} alt={f.id} style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 4 }} />
                                : <div style={{ width: 44, height: 44, background: 'var(--border)', borderRadius: 4 }} />
                              }
                              <div style={{
                                position: 'absolute', top: 2, left: 2,
                                background: 'rgba(255,255,255,0.25)',
                                borderRadius: 3, padding: '1px 3px',
                                fontSize: 9, fontWeight: 700,
                                color: isSelected ? '#fff' : '#4a9eff',
                                lineHeight: 1.4, backdropFilter: 'blur(2px)',
                              }}>
                                {ROMAN[pickerTier]}
                              </div>
                            </div>
                            {/* Name / type / cost */}
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <RarityDot rarity={f.rarity} />
                                <span style={{ fontWeight: 600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {featherDisplayName(f.id)}
                                </span>
                              </div>
                              <TypeChip type={f.type} />
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <span style={{
                                  background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--surface2)',
                                  borderRadius: 3, padding: '0 4px', fontSize: 10,
                                }}>T{pickerTier}</span>
                                <span style={{ fontSize: 10, opacity: 0.75 }}>
                                  {f.tiers[pickerTier]?.totalCost ?? 0} T1
                                </span>
                              </div>
                            </div>
                            {overBudget && <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700, flexShrink: 0 }}>over</span>}
                          </button>
                        );
                        return disabled ? (
                          <div key={fid}>{featherBtn}</div>
                        ) : (
                          <WithTooltip key={fid} tooltip={<FeatherTooltipContent feather={fid} tier={pickerTier} />}>
                            {featherBtn}
                          </WithTooltip>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right: tier picker */}
              <div style={{ width: 190, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                    textTransform: 'uppercase', color: 'var(--muted)',
                  }}>
                    Tier
                  </div>
                  {pickerFeather && (() => {
                    const cost = featherById.get(pickerFeather)?.tiers[pickerTier]?.totalCost ?? 0;
                    return (
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        <b style={{ color: 'var(--text)' }}>{cost}</b> T1
                      </span>
                    );
                  })()}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {Array.from({ length: 20 }, (_, i) => i + 1).map(t => {
                    const isActive = pickerTier === t;
                    const tierOverBudget = !isActive && pickerFeather !== null && wouldExceedBudget(pickerFeather, t);
                    const tierBtn = (
                      <button
                        key={t}
                        disabled={tierOverBudget}
                        onClick={() => {
                          setPickerTier(t);
                          if (pickerFeather) assign(pickerFeather, t);
                        }}
                        style={{
                          padding: '5px 0', borderRadius: 4,
                          fontSize: 11, fontWeight: 600,
                          background: isActive ? 'var(--accent)' : 'var(--surface2)',
                          color: isActive ? '#fff' : tierOverBudget ? 'var(--danger)' : 'var(--text)',
                          border: isActive ? '2px solid var(--accent)' : tierOverBudget ? '2px solid var(--danger)' : '2px solid transparent',
                          cursor: tierOverBudget ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                          opacity: tierOverBudget ? 0.45 : 1,
                        }}
                      >
                        {ROMAN[t]}
                      </button>
                    );
                    return pickerFeather ? (
                      <WithTooltip key={t} tooltip={<TierTooltipContent feather={pickerFeather} tier={t} />} offsetX={-90} offsetY={4}>
                        {tierBtn}
                      </WithTooltip>
                    ) : tierBtn;
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button
                onClick={removeSlot}
                style={{
                  background: 'var(--danger)', color: '#fff',
                  padding: '6px 16px', borderRadius: 6, fontSize: 13,
                }}
              >
                Remove
              </button>
              <button
                onClick={() => setPickerTarget(null)}
                style={{
                  background: 'var(--surface2)', color: 'var(--text)',
                  padding: '6px 16px', borderRadius: 6, fontSize: 13,
                }}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── StatueSimCard ────────────────────────────────────────────────────────────

function StatueSimCard({
  index, kind, statue, selectedSlot, onSlotClick,
}: {
  index: number;
  kind: 'attack' | 'defense';
  statue: SimStatue;
  selectedSlot: number | null;
  onSlotClick: (slotIdx: number) => void;
}) {
  const tpl = statueTemplate(statue);
  const bonus = tpl
    ? (kind === 'attack' ? getAttackBonus(tpl.minTier) : getDefenseBonus(tpl.minTier))
    : null;
  const raw: Partial<Record<StatKey, number>> = tpl ? computeRawStats(tpl) : {};
  const boosted: Partial<Record<StatKey, number>> = tpl && bonus
    ? computeStatueStats(tpl, bonus)
    : {};

  const flatRows = bonus
    ? (Object.entries(bonus.flat) as [StatKey, number][]).filter(([, v]) => v !== 0)
    : [];
  const pctRows = bonus
    ? (Object.entries(bonus.pct) as [string, number][]).filter(([, v]) => v !== 0)
    : [];

  const rawStatKeys = ALL_STAT_KEYS.filter(k => (raw[k] ?? 0) !== 0);

  // Intermediate: raw × (1 + pct%) — only relevant when pct bonuses exist
  const withPct: Partial<Record<StatKey, number>> = {};
  if (bonus && pctRows.length > 0) {
    for (const key of rawStatKeys) {
      const cat = PCT_CATEGORY_MAP[key];
      const pct = cat ? (bonus.pct[cat] ?? 0) : 0;
      withPct[key] = (raw[key] ?? 0) * (1 + pct / 100);
    }
  }
  const withPctKeys = ALL_STAT_KEYS.filter(k => (withPct[k] ?? 0) !== 0);
  const boostedKeys = ALL_STAT_KEYS.filter(k => (boosted[k] ?? 0) !== 0);

  function fmtVal(v: number) { return Number.isInteger(v) ? v : v.toFixed(1); }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, fontSize: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3>#{index}</h3>
        {tpl && (
          <span style={{ background: 'var(--surface2)', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
            T{tpl.minTier} set
          </span>
        )}
      </div>

      {/* Feather slots */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        {statue.map((slot, slotIdx) => {
          const isSelected = selectedSlot === slotIdx;
          const slotDef = slot ? featherById.get(slot.feather) : null;
          const slotButton = (
            <button
              key={slotIdx}
              onClick={() => onSlotClick(slotIdx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 7px', borderRadius: 6, cursor: 'pointer',
                background: isSelected
                  ? 'rgba(91,79,207,0.12)'
                  : slot ? 'var(--surface2)' : 'transparent',
                border: isSelected
                  ? '1.5px solid var(--accent)'
                  : `1.5px dashed ${slot ? 'transparent' : 'var(--border)'}`,
                textAlign: 'left', fontFamily: 'inherit',
                color: 'var(--text)', width: '100%',
                transition: 'background 0.1s',
              }}
            >
              {slot ? (
                <>
                  {/* Image with tier overlay */}
                  <div style={{ position: 'relative', flexShrink: 0, width: 44, height: 44 }}>
                    {featherImages[slot.feather]
                      ? <img src={featherImages[slot.feather]} alt={slot.feather} style={{ width: 44, height: 44, objectFit: 'contain' }} />
                      : <div style={{ width: 44, height: 44, background: 'var(--border)', borderRadius: 3 }} />
                    }
                    <div style={{
                      position: 'absolute', top: 2, left: 2,
                      background: 'rgba(255,255,255,0.25)',
                      borderRadius: 3, padding: '1px 3px',
                      fontSize: 9, fontWeight: 700, color: '#4a9eff',
                      lineHeight: 1.4, backdropFilter: 'blur(2px)',
                    }}>
                      {ROMAN[slot.tier]}
                    </div>
                  </div>
                  {/* Name / type / cost */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {slotDef ? <RarityDot rarity={slotDef.rarity} /> : null}
                      <span style={{ fontWeight: 600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {featherDisplayName(slot.feather)}
                      </span>
                    </div>
                    {slotDef ? <TypeChip type={slotDef.type} /> : null}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ background: 'var(--surface2)', borderRadius: 3, padding: '0 4px', fontSize: 10 }}>T{slot.tier}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                        {slotDef?.tiers[slot.tier]?.totalCost ?? 0} T1
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>+ Add feather</span>
              )}
            </button>
          );
          return slot ? (
            <WithTooltip key={slotIdx} tooltip={<FeatherTooltipContent feather={slot.feather} tier={slot.tier} />}>
              {slotButton}
            </WithTooltip>
          ) : slotButton;
        })}
      </div>

      {/* Section 2: Total Feather Stats */}
      {rawStatKeys.length > 0 && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0 5px' }} />
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>
            Total Feather Stats
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
            {rawStatKeys.map(k => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}</span>
                <span style={{ fontWeight: 600 }}>{fmtVal(raw[k]!)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Section 3: Set Bonuses */}
      {tpl && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0 5px' }} />
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>
            Set Bonuses (T{tpl.minTier})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
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
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>No bonuses at T{tpl.minTier}</span>
            )}
          </div>
        </>
      )}

      {/* Section 4: Total Stats with % Set Bonuses */}
      {withPctKeys.length > 0 && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0 5px' }} />
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>
            Total Stats with % Set Bonuses
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
            {withPctKeys.map(k => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}</span>
                <span style={{ fontWeight: 600 }}>{Math.floor(withPct[k]!)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Section 5: Total Stats with All Set Bonuses */}
      {boostedKeys.length > 0 && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0 5px' }} />
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>
            Total Stats with All Set Bonuses
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {boostedKeys.map(k => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}</span>
                <span style={{ fontWeight: 600 }}>{Math.floor(boosted[k]!)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
