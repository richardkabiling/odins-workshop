import { useState, useRef } from 'react';
import type { FeatherId, StatKey, FeatherDef } from '../domain/types';
import { feathers, featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { computeStatueStats } from '../domain/scoring';
import { STAT_LABELS, ATTACK_STATS, DEFENSE_STATS, PVE_STATS, PVP_STATS } from '../data/statCategories';
import { featherImages } from './featherImages';
import { RarityDot, TypeChip } from './FeatherBadges';
import { FeatherTooltipContent, TierTooltipContent, WithTooltip } from './FeatherTooltip';
import type { Clipboard } from './clipboard';
import type { SimSlot, SimStatue } from './SimulatorView';
import { makeEmptyStatues } from './SimulatorView';
import type { CompareSetup } from '../lib/urlState';
import {
  JsonModal, type JsonModalState,
  serializeStatue, serializeKind, serializeAll,
} from './jsonImportExport';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROMAN = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

const ALL_STAT_KEYS: StatKey[] = [
  ...ATTACK_STATS, ...DEFENSE_STATS, ...PVE_STATS, ...PVP_STATS, 'INTDEXSTR', 'VIT',
];

const SETUP_COLORS = ['#5b4fcf', '#12a37c', '#c27c0e', '#c23a3a'];

function featherDisplayName(id: string) {
  return id === 'Stats' ? 'Valor/Faith/Glory' : id;
}

function statueTemplate(statue: SimStatue) {
  const filled = statue.filter((s): s is NonNullable<SimSlot> => s !== null);
  if (!filled.length) return null;
  return {
    feathers: filled.map(s => ({ feather: s.feather, tier: s.tier })),
    minTier: Math.min(...filled.map(s => s.tier)),
  };
}

function computeSetupTotals(attack: SimStatue[], defense: SimStatue[]): Partial<Record<StatKey, number>> {
  const totals: Partial<Record<StatKey, number>> = {};
  for (const statue of attack) {
    const tpl = statueTemplate(statue);
    if (!tpl) continue;
    const stats = computeStatueStats(tpl, getAttackBonus(tpl.minTier));
    for (const [k, v] of Object.entries(stats) as [StatKey, number][]) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  for (const statue of defense) {
    const tpl = statueTemplate(statue);
    if (!tpl) continue;
    const stats = computeStatueStats(tpl, getDefenseBonus(tpl.minTier));
    for (const [k, v] of Object.entries(stats) as [StatKey, number][]) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return totals;
}

function fmtVal(v: number) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }

// ─── Feather picker (inline, shared with SimulatorView logic) ─────────────────

interface PickerTarget {
  setupIdx: number;
  kind: 'attack' | 'defense';
  statueIdx: number;
  slotIdx: number;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  setups: CompareSetup[];
  onSetupsChange: (next: CompareSetup[]) => void;
  onClear: () => void;
  clipboard: Clipboard | null;
  setClipboard: (c: Clipboard | null) => void;
}

function makeEmptySetup(name: string): CompareSetup {
  return { name, attack: makeEmptyStatues(), defense: makeEmptyStatues() };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CompareView({ setups, onSetupsChange, onClear, clipboard, setClipboard }: Props) {
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [pickerFeather, setPickerFeather] = useState<FeatherId | null>(null);
  const [pickerTier, setPickerTier] = useState<number>(1);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [jsonModal, setJsonModal] = useState<JsonModalState | null>(null);

  function handleShare() {
    setShareOpen(true);
    setCopied(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Setup mutations ───────────────────────────────────────────────────────

  function updateSetup(idx: number, patch: Partial<CompareSetup>) {
    onSetupsChange(setups.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function getStatues(setupIdx: number, kind: 'attack' | 'defense'): SimStatue[] {
    return kind === 'attack' ? (setups[setupIdx].attack as SimStatue[]) : (setups[setupIdx].defense as SimStatue[]);
  }

  function setStatues(setupIdx: number, kind: 'attack' | 'defense', next: SimStatue[]) {
    updateSetup(setupIdx, { [kind]: next });
  }

  function addSetup() {
    if (setups.length >= 4) return;
    onSetupsChange([...setups, makeEmptySetup(`Setup ${setups.length + 1}`)]);
  }

  function removeSetup(idx: number) {
    if (setups.length <= 2) return;
    onSetupsChange(setups.filter((_, i) => i !== idx));
  }

  // ── Copy handlers ─────────────────────────────────────────────────────────

  function handleCopyAll(setupIdx: number) {
    const s = setups[setupIdx];
    setClipboard({ level: 'all', attack: (s.attack as SimStatue[]).map(r => [...r]), defense: (s.defense as SimStatue[]).map(r => [...r]) });
  }

  function handleCopyKind(setupIdx: number, kind: 'attack' | 'defense') {
    const statues = getStatues(setupIdx, kind);
    if (clipboard?.level === 'kind' && clipboard.kind === kind) { setClipboard(null); return; }
    setClipboard({ level: 'kind', kind, statues: statues.map(s => [...s]) });
  }

  function handleCopyStatue(setupIdx: number, kind: 'attack' | 'defense', statueIdx: number) {
    const statue = getStatues(setupIdx, kind)[statueIdx];
    if (clipboard?.level === 'statue' && clipboard.kind === kind && clipboard.statueIdx === statueIdx) { setClipboard(null); return; }
    setClipboard({ level: 'statue', kind, statueIdx, statue: [...statue] });
  }

  function handleCopySlot(setupIdx: number, kind: 'attack' | 'defense', statueIdx: number, slotIdx: number) {
    setClipboard({ level: 'slot', slot: getStatues(setupIdx, kind)[statueIdx][slotIdx] });
  }

  // ── Paste handlers ────────────────────────────────────────────────────────

  function handlePasteAll(setupIdx: number) {
    if (clipboard?.level !== 'all') return;
    updateSetup(setupIdx, {
      attack: clipboard.attack.map(s => [...s]),
      defense: clipboard.defense.map(s => [...s]),
    });
  }

  function handlePasteKind(setupIdx: number, kind: 'attack' | 'defense') {
    if (clipboard?.level !== 'kind') return;
    setStatues(setupIdx, kind, clipboard.statues.map(s => [...s]));
  }

  function handlePasteStatue(setupIdx: number, kind: 'attack' | 'defense', statueIdx: number) {
    if (clipboard?.level !== 'statue') return;
    setStatues(setupIdx, kind, getStatues(setupIdx, kind).map((s, i) => i === statueIdx ? [...clipboard.statue] : s));
  }

  function handlePasteSlot(setupIdx: number, kind: 'attack' | 'defense', statueIdx: number, slotIdx: number) {
    if (clipboard?.level !== 'slot') return;
    setStatues(setupIdx, kind, getStatues(setupIdx, kind).map((s, si) =>
      si !== statueIdx ? s : s.map((sl, li) => li === slotIdx ? clipboard.slot : sl),
    ));
  }

  // ── Tier / remove ────────────────────────────────────────────────────────

  function handleTierChange(setupIdx: number, kind: 'attack' | 'defense', statueIdx: number, slotIdx: number, delta: 1 | -1) {
    const statues = getStatues(setupIdx, kind);
    const slot = statues[statueIdx][slotIdx];
    if (!slot) return;
    const def = featherById.get(slot.feather);
    if (!def) return;
    const newTier = slot.tier + delta;
    if (!def.tiers[newTier]) return;
    setStatues(setupIdx, kind, statues.map((s, si) =>
      si !== statueIdx ? s : s.map((sl, li) => li === slotIdx ? { feather: slot.feather, tier: newTier } : sl),
    ));
    if (pickerTarget?.setupIdx === setupIdx && pickerTarget.kind === kind &&
        pickerTarget.statueIdx === statueIdx && pickerTarget.slotIdx === slotIdx) {
      setPickerTier(newTier);
    }
  }

  function handleRemoveSlot(setupIdx: number, kind: 'attack' | 'defense', statueIdx: number, slotIdx: number) {
    setStatues(setupIdx, kind, getStatues(setupIdx, kind).map((s, si) =>
      si !== statueIdx ? s : s.map((sl, li) => li === slotIdx ? null : sl),
    ));
    if (pickerTarget?.setupIdx === setupIdx && pickerTarget.kind === kind &&
        pickerTarget.statueIdx === statueIdx && pickerTarget.slotIdx === slotIdx) {
      setPickerTarget(null);
    }
  }

  // ── Picker ────────────────────────────────────────────────────────────────

  function openPicker(setupIdx: number, kind: 'attack' | 'defense', statueIdx: number, slotIdx: number) {
    const slot = getStatues(setupIdx, kind)[statueIdx][slotIdx];
    setPickerTarget({ setupIdx, kind, statueIdx, slotIdx });
    setPickerFeather(slot?.feather ?? null);
    setPickerTier(slot?.tier ?? 1);
  }

  function assignPicker(feather: FeatherId, tier: number) {
    if (!pickerTarget) return;
    const { setupIdx, kind, statueIdx, slotIdx } = pickerTarget;
    setStatues(setupIdx, kind, getStatues(setupIdx, kind).map((s, si) =>
      si !== statueIdx ? s : s.map((sl, li) => li === slotIdx ? { feather, tier } : sl),
    ));
  }

  function removePicker() {
    if (!pickerTarget) return;
    const { setupIdx, kind, statueIdx, slotIdx } = pickerTarget;
    setStatues(setupIdx, kind, getStatues(setupIdx, kind).map((s, si) =>
      si !== statueIdx ? s : s.map((sl, li) => li === slotIdx ? null : sl),
    ));
    setPickerTarget(null);
  }

  // ── Picker computed ───────────────────────────────────────────────────────

  const eligibleTypes = pickerTarget
    ? (pickerTarget.kind === 'attack' ? ['Attack', 'Hybrid'] : ['Defense', 'Hybrid'])
    : [];
  const usedInStatue: Set<FeatherId> = pickerTarget
    ? new Set(
        getStatues(pickerTarget.setupIdx, pickerTarget.kind)[pickerTarget.statueIdx]
          .filter((s, i): s is NonNullable<SimSlot> => s !== null && i !== pickerTarget.slotIdx)
          .map(s => s.feather),
      )
    : new Set();
  const groupedFeathers: { label: string; items: FeatherDef[] }[] = [];
  if (pickerTarget) {
    const atk = feathers.filter(f => eligibleTypes.includes(f.type) && f.type === 'Attack');
    const def = feathers.filter(f => eligibleTypes.includes(f.type) && f.type === 'Defense');
    const hyb = feathers.filter(f => eligibleTypes.includes(f.type) && f.type === 'Hybrid');
    if (atk.length) groupedFeathers.push({ label: 'Attack', items: atk });
    if (def.length) groupedFeathers.push({ label: 'Defense', items: def });
    if (hyb.length) groupedFeathers.push({ label: 'Hybrid', items: hyb });
  }

  // ── Comparison table ──────────────────────────────────────────────────────

  const setupTotals = setups.map(s => computeSetupTotals(s.attack as SimStatue[], s.defense as SimStatue[]));
  const activeStatKeys = ALL_STAT_KEYS.filter(k => setupTotals.some(t => (t[k] ?? 0) !== 0));
  const maxPerKey: Partial<Record<StatKey, number>> = {};
  for (const k of activeStatKeys) {
    maxPerKey[k] = Math.max(...setupTotals.map(t => t[k] ?? 0));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Share modal */}
      {shareOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShareOpen(false); }}
        >
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 480, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Share Link</h3>
              <button
                onClick={() => setShareOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}
                aria-label="Close"
              >✕</button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                readOnly
                value={window.location.href}
                style={{ flex: 1, fontSize: 12, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'monospace' }}
                onFocus={e => e.target.select()}
              />
              <button
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy to clipboard'}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: copied ? '#22c55e' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.2s' }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Compare up to 4 feather setups side-by-side.
        </p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={handleShare}
            style={{ fontSize: 12, padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--muted)', cursor: 'pointer' }}
          >
            Share
          </button>
          <button
            onClick={onClear}
            style={{ fontSize: 12, padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--muted)', cursor: 'pointer' }}
          >
            Clear
          </button>
          {setups.length < 4 && (
            <button
              onClick={addSetup}
              style={{
                fontSize: 12, padding: '5px 14px', borderRadius: 6,
                background: 'var(--accent)', color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
              }}
            >
              + Add Setup
            </button>
          )}
        </div>
      </div>

      {/* Setup columns */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${setups.length}, 1fr)`,
        gap: 12,
        alignItems: 'start',
      }}>
        {setups.map((setup, setupIdx) => (
          <SetupColumn
            key={setupIdx}
            setup={setup}
            setupIdx={setupIdx}
            color={SETUP_COLORS[setupIdx]}
            canRemove={setups.length > 2}
            clipboard={clipboard}
            pickerTarget={pickerTarget}
            onNameChange={name => updateSetup(setupIdx, { name })}
            onRemoveSetup={() => removeSetup(setupIdx)}
            onSlotClick={(kind, si, li) => openPicker(setupIdx, kind, si, li)}
            onCopyAll={() => handleCopyAll(setupIdx)}
            onCopyKind={kind => handleCopyKind(setupIdx, kind)}
            onCopyStatue={(kind, si) => handleCopyStatue(setupIdx, kind, si)}
            onCopySlot={(kind, si, li) => handleCopySlot(setupIdx, kind, si, li)}
            onPasteAll={() => handlePasteAll(setupIdx)}
            onPasteKind={kind => handlePasteKind(setupIdx, kind)}
            onPasteStatue={(kind, si) => handlePasteStatue(setupIdx, kind, si)}
            onPasteSlot={(kind, si, li) => handlePasteSlot(setupIdx, kind, si, li)}
            onTierChange={(kind, si, li, d) => handleTierChange(setupIdx, kind, si, li, d)}
            onRemoveSlot={(kind, si, li) => handleRemoveSlot(setupIdx, kind, si, li)}
            onJsonAll={() => setJsonModal({
              title: `${setup.name} — All Statues`,
              exportData: serializeAll(setup.attack as SimStatue[], setup.defense as SimStatue[]),
              parseLevel: 'all',
              onApply: parsed => {
                const { attack, defense } = parsed as { attack: SimStatue[]; defense: SimStatue[] };
                updateSetup(setupIdx, { attack, defense });
              },
            })}
            onJsonKind={kind => setJsonModal({
              title: `${setup.name} — ${kind === 'attack' ? 'Attack' : 'Defense'} Statues`,
              exportData: serializeKind((kind === 'attack' ? setup.attack : setup.defense) as SimStatue[]),
              parseLevel: 'kind',
              onApply: parsed => updateSetup(setupIdx, { [kind]: parsed as SimStatue[] }),
            })}
            onJsonStatue={(kind, si) => {
              const statues = (kind === 'attack' ? setup.attack : setup.defense) as SimStatue[];
              setJsonModal({
                title: `${setup.name} — ${kind === 'attack' ? 'Attack' : 'Defense'} #${si + 1}`,
                exportData: serializeStatue(statues[si]),
                parseLevel: 'statue',
                onApply: parsed => updateSetup(setupIdx, {
                  [kind]: statues.map((s, j) => j === si ? parsed as SimStatue : s),
                }),
              });
            }}
          />
        ))}
      </div>

      {/* Comparison table */}
      {activeStatKeys.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Stat Comparison (with all set bonuses)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>
                    Stat
                  </th>
                  {setups.map((s, i) => (
                    <th key={i} style={{
                      textAlign: 'right', padding: '4px 10px',
                      color: SETUP_COLORS[i], fontWeight: 700,
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}>
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeStatKeys.map(k => {
                  const best = maxPerKey[k] ?? 0;
                  return (
                    <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{STAT_LABELS[k]}</td>
                      {setupTotals.map((t, i) => {
                        const v = t[k] ?? 0;
                        const isBest = v === best && best > 0;
                        return (
                          <td key={i} style={{
                            textAlign: 'right', padding: '4px 10px',
                            fontWeight: isBest ? 700 : 400,
                            color: isBest ? SETUP_COLORS[i] : 'var(--text)',
                          }}>
                            {v === 0 ? '—' : fmtVal(v)}
                            {isBest && setups.length > 1 && <span style={{ fontSize: 9, marginLeft: 3, verticalAlign: 'super' }}>★</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* JSON Modal */}
      {jsonModal && (
        <JsonModal state={jsonModal} onClose={() => setJsonModal(null)} />
      )}

      {/* Feather Picker Modal */}
      {pickerTarget && (
        <>
          <div
            onClick={() => setPickerTarget(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 201, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 12,
            padding: 20, width: 680, maxWidth: '95vw', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', gap: 14,
            boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 15 }}>
                {setups[pickerTarget.setupIdx].name} — {pickerTarget.kind === 'attack' ? 'Attack' : 'Defense'} #{pickerTarget.statueIdx + 1} Slot {pickerTarget.slotIdx + 1}
              </h3>
              <button onClick={() => setPickerTarget(null)} style={{ background: 'none', fontSize: 20, color: 'var(--muted)', padding: '0 6px', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: 16, minHeight: 0, flex: 1, overflow: 'hidden' }}>
              {/* Feather list */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {groupedFeathers.map(({ label, items }) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {items.map(f => {
                        const fid = f.id as FeatherId;
                        const isSelected = pickerFeather === fid;
                        const isUsed = usedInStatue.has(fid);
                        const disabled = isUsed;
                        const btn = (
                          <button
                            key={fid}
                            disabled={disabled}
                            onClick={() => { setPickerFeather(fid); assignPicker(fid, pickerTier); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 10px', borderRadius: 6,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              background: isSelected ? 'var(--accent)' : 'var(--surface2)',
                              color: isSelected ? '#fff' : disabled ? 'var(--muted)' : 'var(--text)',
                              border: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                              opacity: disabled ? 0.4 : 1,
                              textAlign: 'left', fontFamily: 'inherit', fontSize: 12, width: '100%',
                            }}
                          >
                            <div style={{ position: 'relative', flexShrink: 0, width: 44, height: 44 }}>
                              {featherImages[f.id]
                                ? <img src={featherImages[f.id]} alt={f.id} style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 4 }} />
                                : <div style={{ width: 44, height: 44, background: 'var(--border)', borderRadius: 4 }} />
                              }
                              <div style={{ position: 'absolute', top: 2, left: 2, background: 'rgba(255,255,255,0.25)', borderRadius: 3, padding: '1px 3px', fontSize: 9, fontWeight: 700, color: isSelected ? '#fff' : '#4a9eff', lineHeight: 1.4, backdropFilter: 'blur(2px)' }}>
                                {ROMAN[pickerTier]}
                              </div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <RarityDot rarity={f.rarity} />
                                <span style={{ fontWeight: 600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{featherDisplayName(f.id)}</span>
                              </div>
                              <TypeChip type={f.type} />
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <span style={{ background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--surface2)', borderRadius: 3, padding: '0 4px', fontSize: 10 }}>T{pickerTier}</span>
                                <span style={{ fontSize: 10, opacity: 0.75 }}>{f.tiers[pickerTier]?.totalCost ?? 0} T1</span>
                              </div>
                            </div>
                          </button>
                        );
                        return disabled
                          ? <div key={fid}>{btn}</div>
                          : <WithTooltip key={fid} tooltip={<FeatherTooltipContent feather={fid} tier={pickerTier} />}>{btn}</WithTooltip>;
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Tier picker */}
              <div style={{ width: 190, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Tier</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {Array.from({ length: 20 }, (_, i) => i + 1).map(t => {
                    const isActive = pickerTier === t;
                    const btn = (
                      <button
                        key={t}
                        onClick={() => { setPickerTier(t); if (pickerFeather) assignPicker(pickerFeather, t); }}
                        style={{
                          padding: '5px 0', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          background: isActive ? 'var(--accent)' : 'var(--surface2)',
                          color: isActive ? '#fff' : 'var(--text)',
                          border: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        {ROMAN[t]}
                      </button>
                    );
                    return pickerFeather
                      ? <WithTooltip key={t} tooltip={<TierTooltipContent feather={pickerFeather} tier={t} />} offsetX={-90} offsetY={4}>{btn}</WithTooltip>
                      : btn;
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={removePicker} style={{ background: 'var(--danger)', color: '#fff', padding: '6px 16px', borderRadius: 6, fontSize: 13, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
              <button onClick={() => setPickerTarget(null)} style={{ background: 'var(--surface2)', color: 'var(--text)', padding: '6px 16px', borderRadius: 6, fontSize: 13, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── SetupColumn ──────────────────────────────────────────────────────────────

function SetupColumn({
  setup, setupIdx, color, canRemove, clipboard, pickerTarget,
  onNameChange, onRemoveSetup, onSlotClick,
  onCopyAll, onCopyKind, onCopyStatue, onCopySlot,
  onPasteAll, onPasteKind, onPasteStatue, onPasteSlot,
  onTierChange, onRemoveSlot,
  onJsonAll, onJsonKind, onJsonStatue,
}: {
  setup: CompareSetup;
  setupIdx: number;
  color: string;
  canRemove: boolean;
  clipboard: Clipboard | null;
  pickerTarget: PickerTarget | null;
  onNameChange: (name: string) => void;
  onRemoveSetup: () => void;
  onSlotClick: (kind: 'attack' | 'defense', si: number, li: number) => void;
  onCopyAll: () => void;
  onCopyKind: (kind: 'attack' | 'defense') => void;
  onCopyStatue: (kind: 'attack' | 'defense', si: number) => void;
  onCopySlot: (kind: 'attack' | 'defense', si: number, li: number) => void;
  onPasteAll: () => void;
  onPasteKind: (kind: 'attack' | 'defense') => void;
  onPasteStatue: (kind: 'attack' | 'defense', si: number) => void;
  onPasteSlot: (kind: 'attack' | 'defense', si: number, li: number) => void;
  onTierChange: (kind: 'attack' | 'defense', si: number, li: number, delta: 1 | -1) => void;
  onRemoveSlot: (kind: 'attack' | 'defense', si: number, li: number) => void;
  onJsonAll: () => void;
  onJsonKind: (kind: 'attack' | 'defense') => void;
  onJsonStatue: (kind: 'attack' | 'defense', si: number) => void;
}) {
  const [editingName, setEditingName] = useState(false);

  const totals = computeSetupTotals(setup.attack as SimStatue[], setup.defense as SimStatue[]);
  const hasTotals = ALL_STAT_KEYS.some(k => (totals[k] ?? 0) !== 0);

  const showPasteAll = clipboard?.level === 'all';
  const showKindPaste = clipboard?.level === 'kind';
  const showStatuePaste = clipboard?.level === 'statue';
  const showSlotPaste = clipboard?.level === 'slot';

  function renderKindSection(kind: 'attack' | 'defense') {
    const statues = (kind === 'attack' ? setup.attack : setup.defense) as SimStatue[];
    const isKindCopied = clipboard?.level === 'kind' && clipboard.kind === kind;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Kind header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>
            {kind === 'attack' ? 'Attack' : 'Defense'}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {showKindPaste && clipboard?.level === 'kind' && clipboard.kind === kind && (
              <button onClick={() => onPasteKind(kind)} style={btnStyle(true)}>Paste</button>
            )}
            <button onClick={() => onJsonKind(kind)} style={btnStyle(false)} title="Import / Export JSON">
              {'{ }'}
            </button>
            <button
              onClick={() => onCopyKind(kind)}
              style={btnStyle(isKindCopied)}
            >
              {isKindCopied ? '✕' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Statues */}
        {statues.map((statue, si) => {
          const tpl = statueTemplate(statue);
          const isStatueCopied = clipboard?.level === 'statue' && clipboard.kind === kind && clipboard.statueIdx === si;
          const selectedSlot = pickerTarget?.setupIdx === setupIdx && pickerTarget.kind === kind && pickerTarget.statueIdx === si
            ? pickerTarget.slotIdx : null;

          return (
            <div key={si} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', background: 'var(--surface)' }}>
              {/* Statue header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>#{si + 1}{tpl ? ` · T${tpl.minTier}` : ''}</span>
                <div style={{ display: 'flex', gap: 3 }}>
                  {showStatuePaste && (
                    <button onClick={() => onPasteStatue(kind, si)} style={btnStyle(true, true)}>Paste</button>
                  )}
                  <button onClick={() => onJsonStatue(kind, si)} style={btnStyle(false)} title="Import / Export JSON">
                    {'{ }'}
                  </button>
                  <button onClick={() => onCopyStatue(kind, si)} style={btnStyle(isStatueCopied)}>
                    {isStatueCopied ? '✕' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Slots */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {statue.map((slot, li) => {
                  const slotDef = slot ? featherById.get(slot.feather) : null;
                  const canUp = slot && !!slotDef?.tiers[slot.tier + 1];
                  const canDown = slot && slot.tier > 1 && !!slotDef?.tiers[slot.tier - 1];
                  const isSelected = selectedSlot === li;
                  const clipFeather = clipboard?.level === 'slot' ? clipboard.slot?.feather : undefined;
                  const featherAlreadyInStatue = clipFeather != null && statue.some(s => s !== null && s.feather === clipFeather);
                  const canPasteSlot = showSlotPaste && (!featherAlreadyInStatue || slot?.feather === clipFeather);

                  const slotBtn = (
                    <button
                      onClick={() => onSlotClick(kind, si, li)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 6,
                        padding: '5px 7px', borderRadius: 6, cursor: 'pointer',
                        background: isSelected ? 'rgba(91,79,207,0.12)' : slot ? 'var(--surface2)' : 'transparent',
                        border: isSelected ? '1.5px solid var(--accent)' : `1.5px dashed ${slot ? 'transparent' : 'var(--border)'}`,
                        fontFamily: 'inherit', color: 'var(--text)', textAlign: 'left',
                        transition: 'background 0.1s',
                      }}
                    >
                      {slot ? (
                        <>
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

                  const slotBtnStyle = (active = false): React.CSSProperties => ({
                    width: 22, height: 22, border: '1px solid var(--border)',
                    borderRadius: 4, background: active ? 'var(--accent)' : 'var(--surface2)',
                    color: active ? '#fff' : 'var(--muted)', cursor: 'pointer',
                    fontSize: 11, lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'inherit', flexShrink: 0,
                  });

                  const actions = (slot || canPasteSlot) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                      {slot && (
                        <>
                          <button title="Tier up" disabled={!canUp} onClick={e => { e.stopPropagation(); onTierChange(kind, si, li, 1); }} style={{ ...slotBtnStyle(), color: canUp ? 'var(--text)' : 'var(--muted)', cursor: canUp ? 'pointer' : 'default' }}>▲</button>
                          <button title="Tier down" disabled={!canDown} onClick={e => { e.stopPropagation(); onTierChange(kind, si, li, -1); }} style={{ ...slotBtnStyle(), color: canDown ? 'var(--text)' : 'var(--muted)', cursor: canDown ? 'pointer' : 'default' }}>▼</button>
                          <button title="Remove" onClick={e => { e.stopPropagation(); onRemoveSlot(kind, si, li); }} style={slotBtnStyle()}>✕</button>
                          <button title="Copy this slot" onClick={e => { e.stopPropagation(); onCopySlot(kind, si, li); }} style={slotBtnStyle()}>📋</button>
                        </>
                      )}
                      {canPasteSlot && (
                        <button title="Paste slot" onClick={e => { e.stopPropagation(); onPasteSlot(kind, si, li); }} style={slotBtnStyle(true)}>⬇</button>
                      )}
                    </div>
                  ) : null;

                  const row = (
                    <div key={li} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
                      {slotBtn}
                      {actions}
                    </div>
                  );

                  return slot
                    ? <WithTooltip key={li} tooltip={<FeatherTooltipContent feather={slot.feather} tier={slot.tier} />}>{row}</WithTooltip>
                    : row;
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="card" style={{ borderTop: `3px solid ${color}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Column header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        {editingName ? (
          <input
            autoFocus
            value={setup.name}
            onChange={e => onNameChange(e.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false); }}
            style={{
              flex: 1, fontSize: 14, fontWeight: 700, background: 'var(--surface2)',
              border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px',
              color: 'var(--text)', fontFamily: 'inherit',
            }}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            title="Click to rename"
            style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, color, fontFamily: 'inherit', padding: 0 }}
          >
            {setup.name}
          </button>
        )}

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {showPasteAll && (
            <button onClick={onPasteAll} style={btnStyle(true, true, 10)}>Paste All</button>
          )}
          <button
            onClick={onJsonAll}
            title="Import / Export JSON"
            style={btnStyle(false, false, 10)}
          >
            {'{ }'}
          </button>
          <button
            onClick={onCopyAll}
            title="Copy full setup"
            style={btnStyle(clipboard?.level === 'all', false, 10)}
          >
            📋
          </button>
          {canRemove && (
            <button onClick={onRemoveSetup} style={{ ...btnStyle(false), color: 'var(--danger)' }}>✕</button>
          )}
        </div>
      </div>

      {/* Totals summary strip */}
      {hasTotals && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
          {ALL_STAT_KEYS.filter(k => (totals[k] ?? 0) !== 0).map(k => (
            <span key={k} style={{ fontSize: 10 }}>
              <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}: </span>
              <span style={{ fontWeight: 600 }}>{fmtVal(totals[k]!)}</span>
            </span>
          ))}
        </div>
      )}

      {renderKindSection('attack')}
      {renderKindSection('defense')}
    </div>
  );
}

function btnStyle(active = false, accent = false, fontSize = 11): React.CSSProperties {
  return {
    fontSize, padding: '2px 7px', borderRadius: 4,
    background: active || accent ? 'var(--accent)' : 'var(--surface2)',
    color: active || accent ? '#fff' : 'var(--muted)',
    border: `1px solid ${active || accent ? 'var(--accent)' : 'var(--border)'}`,
    cursor: 'pointer', fontFamily: 'inherit',
  };
}
