import type { CSSProperties } from 'react';

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
