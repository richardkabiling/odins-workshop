/**
 * Shared clipboard type and floating ClipboardWidget used by SimulatorView and CompareView.
 * Clipboard state is lifted to App so it persists across tab switches.
 */
import { useState } from 'react';
import type { SimSlot, SimStatue } from './SimulatorView';
import { featherImages } from './featherImages';

// ─── Clipboard type ───────────────────────────────────────────────────────────

export type Clipboard =
  | { level: 'all'; attack: SimStatue[]; defense: SimStatue[] }
  | { level: 'kind'; kind: 'attack' | 'defense'; statues: SimStatue[] }
  | { level: 'statue'; kind: 'attack' | 'defense'; statueIdx: number; statue: SimStatue }
  | { level: 'slot'; slot: SimSlot };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROMAN = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

function featherDisplayName(id: string) {
  return id === 'Stats' ? 'Valor/Faith/Glory' : id;
}

// ─── Mini-preview helpers ─────────────────────────────────────────────────────

export function SlotMiniChip({ slot }: { slot: NonNullable<SimSlot> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', flexShrink: 0, width: 26, height: 26 }}>
        {featherImages[slot.feather]
          ? <img src={featherImages[slot.feather]} alt={slot.feather} style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 3 }} />
          : <div style={{ width: 26, height: 26, background: 'var(--border)', borderRadius: 3 }} />
        }
        <div style={{
          position: 'absolute', top: 1, left: 1,
          background: 'rgba(0,0,0,0.5)', borderRadius: 2,
          padding: '0 2px', fontSize: 7, fontWeight: 700, color: '#4a9eff', lineHeight: 1.6,
        }}>
          {ROMAN[slot.tier]}
        </div>
      </div>
      <div style={{ fontSize: 10, lineHeight: 1.3 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
          {featherDisplayName(slot.feather)}
        </div>
        <div style={{ color: 'var(--muted)' }}>T{slot.tier}</div>
      </div>
    </div>
  );
}

function StatueMiniPreview({ statue }: { statue: SimStatue }) {
  const filled = statue.filter((s): s is NonNullable<SimSlot> => s !== null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {filled.length === 0
        ? <span style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>empty</span>
        : filled.map((s, i) => <SlotMiniChip key={i} slot={s} />)
      }
    </div>
  );
}

export function KindMiniPreview({ statues }: { statues: SimStatue[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
      {statues.map((statue, i) => (
        <div key={i}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>#{i + 1}</div>
          <StatueMiniPreview statue={statue} />
        </div>
      ))}
    </div>
  );
}

// ─── Floating Clipboard Widget ────────────────────────────────────────────────

export function ClipboardWidget({
  clipboard, setClipboard,
}: {
  clipboard: Clipboard | null;
  setClipboard: (c: Clipboard | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (!clipboard) return null;

  const label =
    clipboard.level === 'all' ? 'Full Setup' :
    clipboard.level === 'kind' ? `${clipboard.kind === 'attack' ? 'Attack' : 'Defense'} Statues` :
    clipboard.level === 'statue' ? `${clipboard.kind === 'attack' ? 'Atk' : 'Def'} #${clipboard.statueIdx + 1}` :
    clipboard.level === 'slot' && clipboard.slot
      ? `${featherDisplayName(clipboard.slot.feather)} T${clipboard.slot.tier}`
      : 'Empty Slot';

  const labelFull =
    clipboard.level === 'all' ? 'Full Setup (Attack + Defense)' :
    clipboard.level === 'kind' ? `All ${clipboard.kind === 'attack' ? 'Attack' : 'Defense'} Statues` :
    clipboard.level === 'statue' ? `${clipboard.kind === 'attack' ? 'Attack' : 'Defense'} Statue #${clipboard.statueIdx + 1}` :
    clipboard.level === 'slot' && clipboard.slot
      ? `Slot: ${featherDisplayName(clipboard.slot.feather)} T${clipboard.slot.tier}`
      : 'Empty Slot';

  const btnBase: React.CSSProperties = {
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 400,
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      width: 340, gap: 0,
      filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.35))',
    }}>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--accent)',
          borderBottom: 'none',
          borderRadius: '10px 10px 0 0',
          padding: '10px 12px',
          maxHeight: '55vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflowY: 'auto',
        }}>
          {/* Panel header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Clipboard
            </span>
            <span style={{
              fontSize: 11, padding: '1px 8px', borderRadius: 10,
              background: 'var(--accent)', color: '#fff', fontWeight: 600,
            }}>
              {labelFull}
            </span>
          </div>

          {/* Preview content */}
          <div style={{ overflowX: 'auto' }}>
            {clipboard.level === 'all' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 6 }}>Attack</div>
                  <KindMiniPreview statues={clipboard.attack} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 6 }}>Defense</div>
                  <KindMiniPreview statues={clipboard.defense} />
                </div>
              </div>
            )}
            {clipboard.level === 'kind' && <KindMiniPreview statues={clipboard.statues} />}
            {clipboard.level === 'statue' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {clipboard.statue
                  .filter((s): s is NonNullable<SimSlot> => s !== null)
                  .map((s, i) => <SlotMiniChip key={i} slot={s} />)
                }
              </div>
            )}
            {clipboard.level === 'slot' && clipboard.slot && <SlotMiniChip slot={clipboard.slot} />}
            {clipboard.level === 'slot' && !clipboard.slot && (
              <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>Empty slot</span>
            )}
          </div>


        </div>
      )}

      {/* Handle bar — always visible */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: 'var(--accent)',
        borderRadius: expanded ? '0 0 10px 10px' : 10,
        overflow: 'hidden',
      }}>
        <button
          onClick={() => setExpanded(e => !e)}
          title={expanded ? 'Collapse clipboard' : 'Expand clipboard'}
          style={{
            ...btnBase,
            flex: 1, gap: 7, padding: '8px 12px',
            background: 'transparent', color: '#fff',
            textAlign: 'left', justifyContent: 'flex-start',
          }}
        >
          <span style={{ fontSize: 14 }}>📋</span>
          <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{label}</span>
          <span style={{ fontSize: 12, opacity: 0.8 }}>{expanded ? '▼' : '▲'}</span>
        </button>

        <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.25)' }} />

        <button
          onClick={() => setClipboard(null)}
          title="Clear clipboard"
          style={{
            ...btnBase,
            padding: '8px 12px',
            background: 'transparent', color: 'rgba(255,255,255,0.75)',
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
