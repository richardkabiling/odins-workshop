import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { featherById } from '../data/feathers.generated';
import { STAT_LABELS } from '../data/statCategories';

// ─── Tooltip content ──────────────────────────────────────────────────────────

interface FeatherTooltipContentProps {
  feather: string;
  /** The tier to show in the comparison section. Defaults to 1 (no comparison shown). */
  tier?: number;
}

export function FeatherTooltipContent({ feather, tier = 1 }: FeatherTooltipContentProps) {
  const def = featherById.get(feather);
  if (!def) return null;

  const t1Stats = Object.entries(def.tiers[1]?.stats ?? {}) as [string, number][];
  const tierStats = Object.entries(def.tiers[tier]?.stats ?? {}) as [string, number][];
  const allStatKeys = Array.from(new Set([...t1Stats.map(([k]) => k), ...tierStats.map(([k]) => k)]));

  return (
    <div style={{ fontSize: 12, minWidth: 200 }}>
      <div style={{
        fontWeight: 700, marginBottom: 6, fontSize: 11,
        textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)',
      }}>
        T1 Stats
      </div>
      {t1Stats.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k as keyof typeof STAT_LABELS] ?? k}</span>
          <span style={{ fontWeight: 600 }}>+{v}</span>
        </div>
      ))}
      {tier > 1 && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />
          <div style={{
            fontWeight: 700, marginBottom: 6, fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)',
          }}>
            T{tier} Stats
          </div>
          {allStatKeys.map(k => {
            const tVal = (def.tiers[tier]?.stats as Record<string, number> ?? {})[k] ?? 0;
            return (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k as keyof typeof STAT_LABELS] ?? k}</span>
                <span style={{ fontWeight: 600, color: 'var(--green)' }}>+{tVal}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Tier tooltip content ─────────────────────────────────────────────────────

interface TierTooltipContentProps {
  feather: string;
  tier: number;
}

export function TierTooltipContent({ feather, tier }: TierTooltipContentProps) {
  const def = featherById.get(feather);
  if (!def) return null;

  const cost = def.tiers[tier]?.totalCost ?? 0;
  const t1Stats = Object.entries(def.tiers[1]?.stats ?? {}) as [string, number][];
  const tierStats = Object.entries(def.tiers[tier]?.stats ?? {}) as [string, number][];
  const allStatKeys = Array.from(new Set([...t1Stats.map(([k]) => k), ...tierStats.map(([k]) => k)]));

  return (
    <div style={{ fontSize: 12, minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
        <span style={{ color: 'var(--muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Tier {tier} Cost
        </span>
        <span style={{ fontWeight: 700 }}>{cost} T1</span>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0 6px' }} />
      <div style={{
        fontWeight: 700, marginBottom: 6, fontSize: 11,
        textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)',
      }}>
        {tier === 1 ? 'T1 Stats' : `T${tier} Stats`}
      </div>
      {allStatKeys.map(k => {
      const tVal = (def.tiers[tier]?.stats as Record<string, number> ?? {})[k] ?? 0;
        return (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k as keyof typeof STAT_LABELS] ?? k}</span>
            <span style={{ fontWeight: 600, color: tier === 1 ? undefined : 'var(--green)' }}>+{tVal}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Portal-based tooltip wrapper ─────────────────────────────────────────────

interface WithTooltipProps {
  children: ReactNode;
  tooltip: ReactNode;
  /** Extra x offset from cursor in px (default 14) */
  offsetX?: number;
  /** Extra y offset from cursor in px (default 4) */
  offsetY?: number;
}

/**
 * Wraps children with a hover tooltip rendered into document.body via a portal,
 * so it is never clipped by ancestor overflow or stacking contexts.
 */
export function WithTooltip({ children, tooltip, offsetX = 14, offsetY = 4 }: WithTooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      style={{ position: 'relative', display: 'contents' }}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <div style={{
          position: 'fixed',
          left: pos.x + offsetX,
          top: pos.y + offsetY,
          zIndex: 9999,
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 14px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          pointerEvents: 'none',
          maxWidth: 280,
        }}>
          {tooltip}
        </div>,
        document.body,
      )}
    </div>
  );
}
