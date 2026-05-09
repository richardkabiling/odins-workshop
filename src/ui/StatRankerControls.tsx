import type { CSSProperties } from 'react';
import { useState, useRef, useCallback } from 'react';
import type { StatKey } from '../domain/types';
import {
  type StatRanking,
  type PresetName,
  swapPvX,
  applyPreset,
  PRESETS,
  weightsFromRanking,
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
];

function detectPreset(ranking: StatRanking): PresetName | null {
  const canonical = swapPvX(ranking.order, false); // normalize to PvE
  const rankingGaps = ranking.gaps ?? Array.from({ length: ranking.order.length - 1 }, () => 1);
  for (const [name, preset] of Object.entries(PRESETS)) {
    const presetGaps = preset.gaps ?? Array.from({ length: preset.order.length - 1 }, () => 1);
    if (
      preset.order.length === canonical.length &&
      preset.order.every((s, i) => s === canonical[i]) &&
      presetGaps.every((g, i) => g === rankingGaps[i])
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
  fontSize: 11,
  border: 'none',
  padding: '2px 5px',
  background: 'var(--surface2)',
  cursor: 'pointer',
  borderRadius: 4,
  fontFamily: 'inherit',
  lineHeight: 1,
  flexShrink: 0,
};

const dragHandleStyle: CSSProperties = {
  cursor: 'grab',
  color: 'var(--muted)',
  fontSize: 14,
  lineHeight: 1,
  padding: '0 4px',
  userSelect: 'none',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
};

/** Reorder an array: remove items at draggedIndices, insert before insertBefore
 *  in the post-removal array. Preserves internal gaps of the dragged group;
 *  sets gap=1 between the moved block and its new neighbours. */
function reorderWithGaps(
  order: StatKey[],
  gaps: number[],
  draggedIndices: number[],
  insertBefore: number, // index in original array, before which to insert
): { order: StatKey[]; gaps: number[] } {
  const n = order.length;
  const draggedSet = new Set(draggedIndices);

  // Collect remaining items (not dragged) with their original indices
  const remaining: { stat: StatKey; origIdx: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!draggedSet.has(i)) remaining.push({ stat: order[i], origIdx: i });
  }

  // Recompute gaps for consecutive remaining items: take the max gap
  // of all original gaps in the span between them (to preserve priority breaks).
  const remainingGaps: number[] = [];
  for (let i = 0; i < remaining.length - 1; i++) {
    const a = remaining[i].origIdx;
    const b = remaining[i + 1].origIdx;
    let maxGap = 0;
    for (let j = a; j < b; j++) maxGap = Math.max(maxGap, gaps[j] ?? 1);
    remainingGaps.push(maxGap);
  }

  // Internal gaps of the dragged group (max across any gaps between consecutive dragged items)
  const sorted = [...draggedIndices].sort((a, b) => a - b);
  const internalGaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    let maxGap = 0;
    for (let j = a; j < b; j++) maxGap = Math.max(maxGap, gaps[j] ?? 1);
    internalGaps.push(maxGap);
  }

  // Insert position in the remaining array: first remaining item with origIdx >= insertBefore
  let insertPos = remaining.findIndex(r => r.origIdx >= insertBefore);
  if (insertPos === -1) insertPos = remaining.length;

  const draggedStats = sorted.map(i => order[i]);
  const newOrder = [
    ...remaining.slice(0, insertPos).map(r => r.stat),
    ...draggedStats,
    ...remaining.slice(insertPos).map(r => r.stat),
  ];

  const gapBefore = insertPos > 0 ? 1 : undefined;
  const gapAfter = insertPos < remaining.length ? 1 : undefined;
  const newGaps: number[] = [
    ...remainingGaps.slice(0, Math.max(0, insertPos - 1)),
    ...(gapBefore !== undefined ? [gapBefore] : []),
    ...internalGaps,
    ...(gapAfter !== undefined ? [gapAfter] : []),
    ...remainingGaps.slice(insertPos),
  ];

  return { order: newOrder, gaps: newGaps };
}

/** Insert dragged stats into an existing group, then force gap=0 between
 *  all consecutive merged-group members in the resulting order. */
function dropIntoGroup(
  order: StatKey[],
  gaps: number[],
  draggedIndices: number[],
  targetGroupIndices: number[],
  insertBeforePos: number, // position within target group (0 = before first member)
): { order: StatKey[]; gaps: number[] } {
  const draggedSet = new Set(draggedIndices);
  const targetGroupKeys = new Set(targetGroupIndices.map(i => order[i]));
  const draggedKeys = new Set(draggedIndices.map(i => order[i]));
  const mergedGroupKeys = new Set([...targetGroupKeys, ...draggedKeys]);

  // Remaining target group members after removing dragged
  const remainingGroupIndices = targetGroupIndices.filter(i => !draggedSet.has(i));
  const insertBeforeOrigIdx =
    insertBeforePos < remainingGroupIndices.length
      ? remainingGroupIndices[insertBeforePos]
      : remainingGroupIndices.length > 0
        ? remainingGroupIndices[remainingGroupIndices.length - 1] + 1
        : order.length;

  const { order: newOrder, gaps: newGaps } = reorderWithGaps(order, gaps, draggedIndices, insertBeforeOrigIdx);

  // Force gap=0 between all consecutive members of the merged group
  for (let j = 0; j < newOrder.length - 1; j++) {
    if (mergedGroupKeys.has(newOrder[j]) && mergedGroupKeys.has(newOrder[j + 1])) {
      newGaps[j] = 0;
    }
  }
  return { order: newOrder, gaps: newGaps };
}


export function StatRankerControls({ ranking, onChange, onOptimize, loading }: Props) {
  const activePreset = detectPreset(ranking);

  // Multiselect state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Between-group drop indicator: stat index before which to insert
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  // In-group drop indicator: drop into a specific group at a child position
  const [dropInGroup, setDropInGroup] = useState<{ groupFirstIdx: number; beforePos: number } | null>(null);
  const dragIndices = useRef<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const gaps: number[] = ranking.gaps ?? Array.from({ length: ranking.order.length - 1 }, () => 1);

  function applyChange(newOrder: StatKey[], newGaps: number[]) {
    onChange({ ...ranking, order: newOrder, gaps: newGaps });
  }

  function handlePvpToggle(pvp: boolean) {
    onChange({
      ...ranking,
      pvp,
      order: swapPvX(ranking.order, pvp),
    });
  }

  function handlePreset(name: PresetName) {
    onChange(applyPreset(name, ranking.pvp));
    setSelected(new Set());
  }

  function handleRowClick(e: React.MouseEvent, i: number) {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(i)) next.delete(i); else next.add(i);
      setSelected(next);
    } else if (e.shiftKey && selected.size > 0) {
      const last = Math.max(...selected);
      const lo = Math.min(last, i), hi = Math.max(last, i);
      const next = new Set(selected);
      for (let j = lo; j <= hi; j++) next.add(j);
      setSelected(next);
    } else {
      // No modifier: deselect if this is the sole selection, else select only this
      if (selected.size === 1 && selected.has(i)) setSelected(new Set());
      else setSelected(new Set([i]));
    }
  }

  const handleDragStart = useCallback((e: React.DragEvent, indices: number[]) => {
    dragIndices.current = indices;
    setSelected(new Set(indices));
    e.dataTransfer.effectAllowed = 'move';

    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--surface2').trim() || '#2a2a3e';
    const border = cs.getPropertyValue('--accent').trim() || '#7c3aed';
    const color = cs.getPropertyValue('--text').trim() || '#e2e8f0';
    const muted = cs.getPropertyValue('--muted').trim() || '#888';

    const ghost = document.createElement('div');
    ghost.style.cssText = [
      'position:fixed', 'top:-9999px', 'left:-9999px',
      `background:${bg}`, `border:1.5px solid ${border}`,
      'border-radius:8px', 'padding:5px 10px',
      `font:13px/1.5 system-ui,sans-serif`, `color:${color}`,
      'box-shadow:0 6px 20px rgba(0,0,0,.45)',
      'pointer-events:none', 'min-width:140px',
    ].join(';');

    indices.forEach((idx, pos) => {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:6px;${pos > 0 ? 'margin-top:3px' : ''}`;
      const num = document.createElement('span');
      num.style.cssText = `font-size:11px;font-weight:700;color:${muted};width:18px;text-align:right;flex-shrink:0`;
      num.textContent = String(idx + 1);
      const label = document.createElement('span');
      label.textContent = STAT_LABELS[ranking.order[idx]] ?? ranking.order[idx];
      row.appendChild(num);
      row.appendChild(label);
      ghost.appendChild(row);
    });

    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, -14, ghost.offsetHeight / 2);
    setTimeout(() => ghost.remove(), 0);
  }, [ranking.order]);

  /** Single dragover handler on the list container — computes insert position
   *  from mouse Y vs each group's midpoint. Each direct child is a group wrapper. */
  const handleListDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const list = listRef.current;
    if (!list) return;
    // Build group first-indices (same logic as render)
    const groupFirsts: number[] = ranking.order.length > 0 ? [0] : [];
    for (let i = 1; i < ranking.order.length; i++) {
      if ((gaps[i - 1] ?? 1) > 0) groupFirsts.push(i);
    }
    const children = Array.from(list.children) as HTMLElement[];
    let insertBefore = ranking.order.length;
    for (let ci = 0; ci < children.length; ci++) {
      const rect = children[ci].getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        insertBefore = groupFirsts[ci] ?? 0;
        break;
      }
    }
    setDropInGroup(null);
    setDropTarget(prev => prev === insertBefore ? prev : insertBefore);
  }, [ranking.order, gaps]);

  const handleDragEnd = useCallback(() => {
    setDropTarget(null);
    setDropInGroup(null);
    dragIndices.current = [];
  }, []);

  const isDragging = (dropTarget !== null || dropInGroup !== null) && dragIndices.current.length > 0;
  const draggedStatSet = new Set(dragIndices.current.map(idx => ranking.order[idx]));

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

      {/* Stat ranking list */}
      <div>
        <div style={sectionLabel}>Stat Priority</div>
        <p style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 6, lineHeight: 1.4 }}>
          Drag ⠿ to reorder · ⛓↑⛓↓ to link with neighbour · ⛓️‍💥 to unlink · Ctrl/Shift+click to multi-select, then drag to group
        </p>
        <div
          ref={listRef}
          style={{ display: 'flex', flexDirection: 'column' }}
          onDragOver={handleListDragOver}
          onDrop={(e) => {
            e.preventDefault();
            const dragged = dragIndices.current;
            if (!dragged.length || dropTarget === null) { setDropTarget(null); return; }
            const { order: newOrder, gaps: newGaps } = reorderWithGaps(ranking.order, gaps, dragged, dropTarget);
            // Multiselect drop: force gap=0 between all dragged stats so they form a group
            if (dragged.length > 1) {
              const draggedKeys = new Set(dragged.map(i => ranking.order[i]));
              let prev = -1;
              for (let j = 0; j < newOrder.length; j++) {
                if (draggedKeys.has(newOrder[j])) {
                  if (prev >= 0 && j === prev + 1) newGaps[j - 1] = 0;
                  prev = j;
                }
              }
            }
            applyChange(newOrder, newGaps);
            setDropTarget(null);
            dragIndices.current = [];
            setSelected(new Set());
          }}
          onDragLeave={(e) => {
            if (!listRef.current?.contains(e.relatedTarget as Node)) {
              setDropTarget(null);
              setDropInGroup(null);
            }
          }}
        >
          {(() => {
            const weights = weightsFromRanking(ranking);
            const allWeights = ranking.order.map(s => weights[s] ?? 1);
            const maxWeight = Math.max(...allWeights);
            const fmtWeight = (v: number) => v >= 10 ? v.toFixed(1) : v.toPrecision(3).replace(/\.?0+$/, '');

            // Build groups: each is an array of consecutive stat indices sharing gap=0
            const groups: number[][] = [];
            if (ranking.order.length > 0) {
              let g: number[] = [0];
              for (let i = 1; i < ranking.order.length; i++) {
                if ((gaps[i - 1] ?? 1) === 0) { g.push(i); }
                else { groups.push(g); g = [i]; }
              }
              groups.push(g);
            }

            return groups.map((groupIndices) => {
              const firstIdx = groupIndices[0];
              const lastIdx = groupIndices[groupIndices.length - 1];
              const isSingle = groupIndices.length === 1;
              const gapAfterGroup = lastIdx < gaps.length ? gaps[lastIdx] : null;
              const hasSeparatorBelow = gapAfterGroup !== null && gapAfterGroup > 0;

              const myWeight = weights[ranking.order[firstIdx]] ?? 1;
              const weightPct = maxWeight > 0 ? (myWeight / maxWeight) * 100 : 100;

              const showDropBefore = isDragging && dropTarget === firstIdx;
              const showDropAfter = isDragging && lastIdx === ranking.order.length - 1 && dropTarget === ranking.order.length;
              const groupBeingDragged = isDragging && groupIndices.every(i => draggedStatSet.has(ranking.order[i]));
              const anySelected = groupIndices.some(i => selected.has(i));

              // Gap controls rendered on the group header
              const linkUpBtn = firstIdx > 0 ? (
                <button type="button" style={{ ...arrowBtn, opacity: isDragging ? 0.3 : 1, fontSize: 13, padding: '1px 5px' }} onClick={(e) => { e.stopPropagation(); if (!isDragging) { const g = [...gaps]; g[firstIdx - 1] = 0; applyChange(ranking.order, g); } }} disabled={isDragging} title={isSingle ? 'Set same priority as stat above' : 'Merge group above into this group'}>⛓↑</button>
              ) : null;
              const unlinkGroupBtn = !isSingle ? (
                <button type="button" style={{ ...arrowBtn, opacity: isDragging ? 0.3 : 1, fontSize: 13, padding: '1px 5px' }} onClick={(e) => { e.stopPropagation(); if (!isDragging) { const g = [...gaps]; for (let j = firstIdx; j < lastIdx; j++) { if ((g[j] ?? 1) === 0) g[j] = 1; } applyChange(ranking.order, g); } }} disabled={isDragging} title="Unlink group (split all members)">⛓️‍💥</button>
              ) : null;
              const linkDownBtn = lastIdx < ranking.order.length - 1 ? (
                <button type="button" style={{ ...arrowBtn, opacity: isDragging ? 0.3 : 1, fontSize: 13, padding: '1px 5px' }} onClick={(e) => { e.stopPropagation(); if (!isDragging) { const g = [...gaps]; g[lastIdx] = 0; applyChange(ranking.order, g); } }} disabled={isDragging} title={isSingle ? 'Set same priority as stat below' : 'Merge next stat/group into this group'}>⛓↓</button>
              ) : null;
              const gapControls = (linkUpBtn || unlinkGroupBtn || linkDownBtn) ? (
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {linkUpBtn}{unlinkGroupBtn}{linkDownBtn}
                </div>
              ) : null;

              // Shared header row (used both as the full row for singles and the header for multi-groups)
              const headerRow = (
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, groupIndices)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => { groupIndices.forEach(i => handleRowClick(e, i)); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 6px',
                    background: groupBeingDragged
                      ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                      : anySelected
                        ? 'var(--accent-muted, color-mix(in srgb, var(--accent) 18%, var(--surface)))'
                        : 'var(--surface)',
                    border: `1px solid ${groupBeingDragged || anySelected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: isSingle ? 6 : '6px 6px 0 0',
                    cursor: 'default',
                    transition: isDragging ? 'none' : 'background 0.1s, border-color 0.1s',
                  }}
                >
                  <span style={dragHandleStyle} title="Drag to reorder">⠿</span>
                  <span style={{ width: 20, textAlign: 'right', fontWeight: 700, fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
                    {firstIdx + 1}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 72, flexShrink: 0 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${weightPct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: isDragging ? 'none' : 'width 0.15s' }} />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 28, textAlign: 'right', flexShrink: 0 }}>
                      {fmtWeight(myWeight)}×
                    </span>
                  </div>
                  {isSingle && (
                    <span style={{ flex: 1, fontSize: 13 }}>
                      {STAT_LABELS[ranking.order[firstIdx]] ?? ranking.order[firstIdx]}
                    </span>
                  )}
                  {!isSingle && (
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
                      {groupIndices.length} stats
                    </span>
                  )}
                  {gapControls}
                </div>
              );

              return (
                <div key={`group-${firstIdx}`}>
                  {showDropBefore && (
                    <div style={{ height: 2, background: 'var(--accent)', borderRadius: 1, margin: '1px 0' }} />
                  )}

                  {headerRow}

                  {/* Indented stat rows for multi-stat groups */}
                  {!isSingle && (
                    <div
                      style={{
                        borderLeft: '2px solid var(--accent)',
                        borderRight: '1px solid var(--accent)',
                        borderBottom: '1px solid var(--accent)',
                        borderRadius: '0 0 6px 6px',
                        background: 'color-mix(in srgb, var(--accent) 5%, var(--surface))',
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTarget(null);
                        const children = Array.from(e.currentTarget.children) as HTMLElement[];
                        let beforePos = groupIndices.length;
                        for (let ci = 0; ci < children.length; ci++) {
                          const rect = children[ci].getBoundingClientRect();
                          if (e.clientY < rect.top + rect.height / 2) { beforePos = ci; break; }
                        }
                        setDropInGroup(prev =>
                          prev?.groupFirstIdx === firstIdx && prev?.beforePos === beforePos ? prev
                            : { groupFirstIdx: firstIdx, beforePos }
                        );
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropInGroup(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const dragged = dragIndices.current;
                        if (!dragged.length || dropInGroup === null) { setDropInGroup(null); return; }
                        const { order: newOrder, gaps: newGaps } = dropIntoGroup(
                          ranking.order, gaps, dragged, groupIndices, dropInGroup.beforePos
                        );
                        // Multiselect: also force gap=0 between consecutive dragged stats
                        if (dragged.length > 1) {
                          const draggedKeys = new Set(dragged.map(i => ranking.order[i]));
                          let prev = -1;
                          for (let j = 0; j < newOrder.length; j++) {
                            if (draggedKeys.has(newOrder[j])) {
                              if (prev >= 0 && j === prev + 1) newGaps[j - 1] = 0;
                              prev = j;
                            }
                          }
                        }
                        applyChange(newOrder, newGaps);
                        setDropInGroup(null);
                        setDropTarget(null);
                        dragIndices.current = [];
                        setSelected(new Set());
                      }}
                    >
                      {groupIndices.map((statIdx, pos) => {
                        const stat = ranking.order[statIdx];
                        const statSelected = selected.has(statIdx);
                        const isLast = pos === groupIndices.length - 1;
                        const showChildDropBefore = dropInGroup?.groupFirstIdx === firstIdx && dropInGroup.beforePos === pos;
                        const showChildDropAfter = isLast && dropInGroup?.groupFirstIdx === firstIdx && dropInGroup.beforePos === groupIndices.length;

                        function childUnlink() {
                          // Extract stat out of its group, placing it just above the group as its own rank
                          const { order: no, gaps: ng } = reorderWithGaps(ranking.order, gaps, [statIdx], firstIdx);
                          applyChange(no, ng);
                        }

                        return (
                          <div key={stat}>
                            {showChildDropBefore && (
                              <div style={{ height: 2, background: 'var(--accent)', borderRadius: 1, margin: '1px 6px' }} />
                            )}
                            <div
                              onClick={(e) => handleRowClick(e, statIdx)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '3px 6px 3px 12px',
                                fontSize: 13,
                                borderTop: pos > 0 && !showChildDropBefore ? '1px solid color-mix(in srgb, var(--accent) 20%, var(--border))' : undefined,
                                background: statSelected ? 'color-mix(in srgb, var(--accent) 18%, var(--surface))' : 'transparent',
                                cursor: 'default',
                                userSelect: 'none',
                              }}
                            >
                              <span
                                draggable
                                onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, [statIdx]); }}
                                onDragEnd={handleDragEnd}
                                style={{ ...dragHandleStyle, fontSize: 12 }}
                                title="Drag to move"
                              >⠿</span>
                              <span style={{ flex: 1 }}>{STAT_LABELS[stat] ?? stat}</span>
                              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                                <button type="button" style={{ ...arrowBtn, opacity: isDragging ? 0.3 : 1, fontSize: 13, padding: '1px 5px' }} disabled={isDragging} onClick={(e) => { e.stopPropagation(); childUnlink(); }} title="Unlink from group">⛓️‍💥</button>
                              </div>
                            </div>
                            {showChildDropAfter && (
                              <div style={{ height: 2, background: 'var(--accent)', borderRadius: 1, margin: '1px 6px' }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {hasSeparatorBelow && !isDragging && <div style={{ height: 4 }} />}
                  {!hasSeparatorBelow && <div style={{ height: 3 }} />}

                  {showDropAfter && (
                    <div style={{ height: 2, background: 'var(--accent)', borderRadius: 1, margin: '1px 0' }} />
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Optimize button */}
      <button className="primary" onClick={onOptimize} disabled={loading}>
        {loading ? 'Optimizing…' : 'Optimize'}
      </button>
    </div>
  );
}
