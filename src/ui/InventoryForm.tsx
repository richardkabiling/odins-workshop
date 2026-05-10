import { useState, useRef } from 'react';
import type { FeatherId, ConversionSet, Inventory } from '../domain/types';
import { feathers, featherById } from '../data/feathers.generated';
import { featherImages } from './featherImages';
import { STAT_LABELS } from '../data/statCategories';
import { RarityDot, TypeChip } from './FeatherBadges';

function featherDisplayName(id: string): string {
  return id === 'Stats' ? 'Valor/Faith/Glory' : id;
}

const SETS: { id: ConversionSet; label: string }[] = [
  { id: 'STDN', label: 'Space / Time / Divine / Nature' },
  { id: 'LD',   label: 'Light / Dark' },
  { id: 'DN',   label: 'Day / Night' },
  { id: 'ST',   label: 'Sky / Terra' },
  { id: 'Purple', label: 'Purple Feathers' },
];

interface Props {
  inventory: Inventory;
  onChange: (inv: Inventory) => void;
  onClear: () => void;
}

function FeatherInventoryCard({
  featherId,
  value,
  onChange,
  onBlur,
}: {
  featherId: FeatherId;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const def = featherById.get(featherId);
  const t1Stats = def ? (Object.entries(def.tiers[1]?.stats ?? {}) as [string, number][]) : [];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '8px 8px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      position: 'relative',
    }}>
      {/* Image + info row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Image with tooltip anchor */}
        <div style={{ position: 'relative', flexShrink: 0, width: 44, height: 44 }}>
          {featherImages[featherId]
            ? <img src={featherImages[featherId]} alt={featherId} style={{ width: 44, height: 44, objectFit: 'contain', display: 'block' }} />
            : <div style={{ width: 44, height: 44, background: 'var(--surface2)', borderRadius: 6 }} />
          }
          {hovered && t1Stats.length > 0 && (
            <div style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              zIndex: 200,
              marginLeft: 8,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 14px',
              minWidth: 180,
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              fontSize: 12,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>
                T1 Stats
              </div>
              {t1Stats.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k as keyof typeof STAT_LABELS] ?? k}</span>
                  <span style={{ fontWeight: 600 }}>+{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info: rarity + name / type chip / T1 cost */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {def && <RarityDot rarity={def.rarity} />}
            <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {featherDisplayName(featherId)}
            </span>
          </div>
          {def && <TypeChip type={def.type} />}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)', fontSize: 10 }}>
              T1 cost: <b style={{ color: 'var(--text)' }}>{def?.tiers[1]?.totalCost ?? 1}</b>
            </span>
          </div>
        </div>
      </div>

      {/* Count input */}
      <input
        type="number"
        min={0}
        value={value}
        placeholder="0"
        onFocus={e => e.target.select()}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        style={{ width: '100%', textAlign: 'center', fontSize: 13 }}
      />
    </div>
  );
}

export function InventoryForm({ inventory, onChange, onClear }: Props) {
  const [raw, setRaw] = useState<Partial<Record<FeatherId, string>>>({});
  const [expanded, setExpanded] = useState<Set<ConversionSet>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function displayValue(id: FeatherId): string {
    if (raw[id] !== undefined) return raw[id]!;
    const n = inventory.perFeather[id] ?? 0;
    return n > 0 ? String(n) : '';
  }

  function handleChange(id: FeatherId, value: string) {
    setRaw(prev => ({ ...prev, [id]: value }));
    const n = value === '' ? 0 : Math.max(0, parseInt(value) || 0);
    onChange({ perFeather: { ...inventory.perFeather, [id]: n } });
  }

  function handleBlur(id: FeatherId) {
    setRaw(prev => { const next = { ...prev }; delete next[id]; return next; });
  }

  function toggleExpand(setId: ConversionSet) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(setId)) next.delete(setId); else next.add(setId);
      return next;
    });
  }

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Feather Inventory</h2>
        <div style={{ display: 'flex', gap: 6 }}>
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
        </div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.4 }}>
        Enter Tier-1 feather counts. Hover an image to see its T1 stats. Feathers in the same set are pooled freely.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {SETS.map(({ id: setId, label }) => {
          const setFeathers = feathers.filter(f => f.set === setId);
          const total = setFeathers.reduce((sum, f) => sum + (inventory.perFeather[f.id as FeatherId] ?? 0), 0);
          const isOpen = expanded.has(setId);
          return (
            <div key={setId} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--surface)' }}>
              {/* Collapsed header row */}
              <div
                onClick={() => toggleExpand(setId)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Interchangeable T1 Feather Pool: <b style={{ color: total > 0 ? 'var(--text)' : 'var(--muted)' }}>{total}</b></span>
              </div>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px' }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
                    gap: 6,
                  }}>
                    {setFeathers.map(f => (
                      <FeatherInventoryCard
                        key={f.id}
                        featherId={f.id as FeatherId}
                        value={displayValue(f.id as FeatherId)}
                        onChange={v => handleChange(f.id as FeatherId, v)}
                        onBlur={() => handleBlur(f.id as FeatherId)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

