import type { CSSProperties } from 'react';
import type { OptimizerMode } from '../domain/types';

interface Props {
  atkPct: number;
  pvp: boolean;
  mode: OptimizerMode;
  onAtkPctChange: (v: number) => void;
  onPvpChange: (v: boolean) => void;
  onModeChange: (m: OptimizerMode) => void;
  onOptimize: () => void;
  loading: boolean;
}

const MODES: { value: OptimizerMode; label: string; speed: string; desc: string }[] = [
  {
    value: 'greedy',
    label: 'Greedy',
    speed: 'Fastest',
    desc: 'Joint ILP at tier 1 picks feather identities, then a greedy pass upgrades tiers. Fast and practical.',
  },
  {
    value: 'tier-enum',
    label: 'Tier Enumeration',
    speed: 'Fast',
    desc: 'Solves one joint ILP per (attack minTier, defense minTier) pair. Globally optimal within the enumeration (~50–100 MIPs). More thorough than greedy.',
  },
  {
    value: 'joint-mip',
    label: 'Joint MIP',
    speed: 'Slow',
    desc: 'Single large ILP with linearised set-bonus via McCormick constraints (~3 000 binary variables). Reference formulation — may be slow or time out in-browser.',
  },
];

export function OptimizationControls({ atkPct, pvp, mode, onAtkPctChange, onPvpChange, onModeChange, onOptimize, loading }: Props) {
  const defPct = 100 - atkPct;

  function sliderLabel() {
    if (atkPct === 50) return '50% Offensive · 50% Defensive';
    return `${atkPct}% Offensive · ${defPct}% Defensive`;
  }

  function sliderDesc() {
    if (atkPct === 50) return 'Budget split equally. Attack statues are optimized first.';
    if (atkPct > 50) return `Attack statues optimized first with ${atkPct}% of your feather budget. All statues score offensive stats.`;
    return `Defense statues optimized first with ${defPct}% of your feather budget. All statues score defensive stats.`;
  }

  const toggleBase: CSSProperties = {
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
          Offensive / Defensive Priority
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: '#1010a0', fontWeight: 600 }}>Defensive</span>
          <span style={{ color: '#a01010', fontWeight: 600 }}>Offensive</span>
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

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
          Optimizer
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MODES.map(m => (
            <label
              key={m.value}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                padding: '8px 10px', borderRadius: 6, border: '1px solid',
                borderColor: mode === m.value ? 'var(--accent)' : 'var(--border)',
                background: mode === m.value ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--surface)',
                transition: 'border-color 0.12s, background 0.12s',
              }}
            >
              <input
                type="radio"
                name="optimizer-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => onModeChange(m.value)}
                style={{ marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{m.label}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
                    padding: '1px 5px', borderRadius: 3,
                    background: m.speed === 'Fastest' ? '#16a34a' : m.speed === 'Fast' ? '#ca8a04' : '#dc2626',
                    color: '#fff',
                  }}>
                    {m.speed}
                  </span>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.4, margin: 0 }}>
                  {m.desc}
                </p>
              </div>
            </label>
          ))}
        </div>
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
