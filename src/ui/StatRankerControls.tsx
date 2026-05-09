import type { CSSProperties } from 'react';
import type { StatKey } from '../domain/types';
import {
  type StatRanking,
  type PresetName,
  swapPvX,
  applyPreset,
  PRESETS,
} from '../domain/ranking';

interface Props {
  ranking: StatRanking;
  onChange: (r: StatRanking) => void;
  onOptimize: () => void;
  loading: boolean;
}

const STAT_LABELS: Record<StatKey, string> = {
  PATK: 'P.ATK',
  MATK: 'M.ATK',
  IgnorePDEF: 'Ignore P.DEF',
  IgnoreMDEF: 'Ignore M.DEF',
  PDMG: 'P.DMG',
  MDMG: 'M.DMG',
  PDEF: 'P.DEF',
  MDEF: 'M.DEF',
  HP: 'HP',
  PDMGReduction: 'P.DMG Reduction',
  MDMGReduction: 'M.DMG Reduction',
  PvEDmgBonus: 'PvE DMG Bonus',
  PvEDmgReduction: 'PvE DMG Reduction',
  PvPDmgBonus: 'PvP DMG Bonus',
  PvPDmgReduction: 'PvP DMG Reduction',
  INTDEXSTR: 'INT/DEX/STR',
  VIT: 'VIT',
};

const PRESET_NAMES: PresetName[] = [
  'Pure Offense',
  'Pure Defense',
  'Balanced',
  'Glass Cannon',
  'Tank',
];

function detectPreset(ranking: StatRanking): PresetName | null {
  const canonical = swapPvX(ranking.order, false); // normalize to PvE
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (
      Math.abs(preset.ratio - ranking.ratio) < 0.001 &&
      preset.order.length === canonical.length &&
      preset.order.every((s, i) => s === canonical[i])
    ) {
      return name as PresetName;
    }
  }
  return null;
}

const sectionLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: 6,
};

const toggleBase: CSSProperties = {
  flex: 1,
  padding: '8px 0',
  textAlign: 'center',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  fontFamily: 'inherit',
};

const arrowBtn: CSSProperties = {
  fontSize: 12,
  border: 'none',
  padding: '2px 6px',
  background: 'var(--surface2)',
  cursor: 'pointer',
  borderRadius: 4,
  fontFamily: 'inherit',
  lineHeight: 1,
};

export function StatRankerControls({ ranking, onChange, onOptimize, loading }: Props) {
  const activePreset = detectPreset(ranking);

  function handlePvpToggle(pvp: boolean) {
    onChange({
      ...ranking,
      pvp,
      order: swapPvX(ranking.order, pvp),
    });
  }

  function handlePreset(name: PresetName) {
    onChange(applyPreset(name, ranking.pvp));
  }

  function handleRatioChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...ranking, ratio: Number(e.target.value) });
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const order = [...ranking.order];
    [order[index - 1], order[index]] = [order[index], order[index - 1]];
    onChange({ ...ranking, order });
  }

  function moveDown(index: number) {
    if (index === ranking.order.length - 1) return;
    const order = [...ranking.order];
    [order[index], order[index + 1]] = [order[index + 1], order[index]];
    onChange({ ...ranking, order });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2>Optimization</h2>

      {/* PvE / PvP toggle */}
      <div>
        <div style={sectionLabel}>Content Type</div>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <button
            type="button"
            style={{ ...toggleBase, background: !ranking.pvp ? 'var(--accent)' : 'var(--surface)', color: !ranking.pvp ? '#fff' : 'var(--muted)' }}
            onClick={() => handlePvpToggle(false)}
          >
            PvE
          </button>
          <button
            type="button"
            style={{ ...toggleBase, background: ranking.pvp ? 'var(--accent)' : 'var(--surface)', color: ranking.pvp ? '#fff' : 'var(--muted)' }}
            onClick={() => handlePvpToggle(true)}
          >
            PvP
          </button>
        </div>
      </div>

      {/* Preset chips */}
      <div>
        <div style={sectionLabel}>Preset</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_NAMES.map((name) => {
            const active = activePreset === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => handlePreset(name)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 10px',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 20,
                  background: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ratio slider */}
      <div>
        <div style={sectionLabel}>Weight Spread</div>
        <input
          type="range"
          min={1.0}
          max={2.0}
          step={0.05}
          value={ranking.ratio}
          onChange={handleRatioChange}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
        <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
          {ranking.ratio <= 1.01
            ? 'All stats weighted equally (no spread)'
            : `Each stat is ${ranking.ratio.toFixed(2)}× more important than the one below`}
        </p>
      </div>

      {/* Stat ranking list */}
      <div>
        <div style={sectionLabel}>Stat Priority</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ranking.order.map((stat, i) => (
            <div
              key={stat}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 6px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              <span
                style={{
                  width: 24,
                  textAlign: 'right',
                  fontWeight: 700,
                  fontSize: 12,
                  color: 'var(--muted)',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 13 }}>
                {STAT_LABELS[stat] ?? stat}
              </span>
              <div style={{ display: 'flex', gap: 3 }}>
                {i > 0 ? (
                  <button type="button" style={arrowBtn} onClick={() => moveUp(i)} title="Move up">
                    ▲
                  </button>
                ) : (
                  <span style={{ width: 28 }} />
                )}
                {i < ranking.order.length - 1 ? (
                  <button type="button" style={arrowBtn} onClick={() => moveDown(i)} title="Move down">
                    ▼
                  </button>
                ) : (
                  <span style={{ width: 28 }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Optimize button */}
      <button className="primary" onClick={onOptimize} disabled={loading}>
        {loading ? 'Optimizing…' : 'Optimize'}
      </button>
    </div>
  );
}
