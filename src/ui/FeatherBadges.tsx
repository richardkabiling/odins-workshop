import type { FeatherType, Rarity } from '../domain/types';

/** Monochrome SVG icon for feather type */
function TypeIcon({ type, color }: { type: FeatherType; color: string }) {
  if (type === 'Attack') {
    // Two crossed swords
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ display: 'block', flexShrink: 0 }}>
        {/* Sword 1: top-left to bottom-right */}
        <line x1="2" y1="2" x2="14" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <line x1="2" y1="4.5" x2="4.5" y2="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="11.5" y1="14" x2="14" y2="11.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        {/* Sword 2: top-right to bottom-left */}
        <line x1="14" y1="2" x2="2" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <line x1="14" y1="4.5" x2="11.5" y2="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="4.5" y1="14" x2="2" y2="11.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        {/* Cross-guard lines */}
        <line x1="5" y1="5" x2="5" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="11" y1="5" x2="11" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'Defense') {
    // Shield shape
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ display: 'block', flexShrink: 0 }}>
        <path
          d="M8 1.5 L14 4 L14 9 Q14 13.5 8 15 Q2 13.5 2 9 L2 4 Z"
          fill={color}
        />
      </svg>
    );
  }
  // Hybrid: diamond
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M8 1 L15 8 L8 15 L1 8 Z" fill={color} />
    </svg>
  );
}

const TYPE_CHIP_STYLE: Record<FeatherType, { bg: string; color: string; iconColor: string }> = {
  Attack: { bg: '#f59e0b', color: '#fff', iconColor: '#fff' },
  Defense: { bg: '#6b7280', color: '#fff', iconColor: '#fff' },
  Hybrid: { bg: '#f3f4f6', color: '#374151', iconColor: '#374151' },
};

export function TypeChip({ type }: { type: FeatherType }) {
  const style = TYPE_CHIP_STYLE[type];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      background: style.bg,
      color: style.color,
      borderRadius: 4,
      padding: '1px 5px',
      fontSize: 9,
      fontWeight: 600,
      lineHeight: 1.6,
      border: type === 'Hybrid' ? '1px solid #d1d5db' : 'none',
      flexShrink: 0,
      alignSelf: 'flex-start',
    }}>
      <TypeIcon type={type} color={style.iconColor} />
      {type}
    </span>
  );
}

export function RarityDot({ rarity }: { rarity: Rarity }) {
  return (
    <span
      title={rarity}
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: rarity === 'Orange' ? '#f97316' : '#a855f7',
        flexShrink: 0,
      }}
    />
  );
}
