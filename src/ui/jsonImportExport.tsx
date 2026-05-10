/**
 * Shared JSON import / export helpers and modal for SimulatorView + CompareView.
 *
 * JSON formats (as simple as possible):
 *   Slot   : ["FeatherId", tier]  or  null
 *   Statue : array of exactly 5 slots
 *   Kind   : array of exactly 5 statues
 *   All    : { "attack": <kind>, "defense": <kind> }
 */
import { useState } from 'react';
import type { FeatherId } from '../domain/types';
import type { SimSlot, SimStatue } from './SimulatorView';

// ─── Serialize ────────────────────────────────────────────────────────────────

export function serializeSlot(slot: SimSlot): [string, number] | null {
  if (!slot) return null;
  return [slot.feather, slot.tier];
}

export function serializeStatue(statue: SimStatue): ([string, number] | null)[] {
  return statue.map(serializeSlot);
}

export function serializeKind(statues: SimStatue[]): ([string, number] | null)[][] {
  return statues.map(serializeStatue);
}

export function serializeAll(
  attack: SimStatue[],
  defense: SimStatue[],
): { attack: ([string, number] | null)[][]; defense: ([string, number] | null)[][] } {
  return { attack: serializeKind(attack), defense: serializeKind(defense) };
}

// ─── Parse ────────────────────────────────────────────────────────────────────

const FEATHER_IDS = new Set<string>([
  'Space', 'Time', 'Divine', 'Nature', 'Light', 'Dark', 'Day', 'Night',
  'Sky', 'Terra', 'Justice', 'Grace', 'Stats', 'Soul', 'Virtue', 'Mercy',
]);

export function parseSlot(raw: unknown): SimSlot {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length < 2) throw new Error(`Invalid slot: ${JSON.stringify(raw)}`);
  const [id, tier] = raw;
  if (typeof id !== 'string' || !FEATHER_IDS.has(id)) throw new Error(`Unknown feather id: ${JSON.stringify(id)}`);
  if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 1 || tier > 20)
    throw new Error(`Invalid tier ${JSON.stringify(tier)} for ${id}`);
  return { feather: id as FeatherId, tier };
}

export function parseStatue(raw: unknown): SimStatue {
  if (!Array.isArray(raw)) throw new Error('Statue must be an array');
  if (raw.length !== 5) throw new Error(`Statue must have exactly 5 slots, got ${raw.length}`);
  return raw.map(parseSlot) as SimStatue;
}

export function parseKind(raw: unknown): SimStatue[] {
  if (!Array.isArray(raw)) throw new Error('Expected an array of 5 statues');
  if (raw.length !== 5) throw new Error(`Expected 5 statues, got ${raw.length}`);
  return raw.map((s, i) => {
    try { return parseStatue(s); }
    catch (e) { throw new Error(`Statue #${i + 1}: ${(e as Error).message}`); }
  });
}

export function parseAll(raw: unknown): { attack: SimStatue[]; defense: SimStatue[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new Error('Expected an object with "attack" and "defense" keys');
  const obj = raw as Record<string, unknown>;
  const attack = parseKind(obj.attack);
  const defense = parseKind(obj.defense);
  return { attack, defense };
}

// ─── JsonModal ────────────────────────────────────────────────────────────────

export type ParseLevel = 'all' | 'kind' | 'statue';

export interface JsonModalState {
  title: string;
  exportData: unknown;
  parseLevel: ParseLevel;
  onApply: (parsed: SimStatue | SimStatue[] | { attack: SimStatue[]; defense: SimStatue[] }) => void;
}

const PARSE_HINT: Record<ParseLevel, string> = {
  statue: 'Array of 5 slots. Each slot: ["FeatherId", tier] or null.',
  kind:   'Array of 5 statues. Each statue: array of 5 slots.',
  all:    'Object with "attack" and "defense" keys, each an array of 5 statues.',
};

export function JsonModal({
  state,
  onClose,
}: {
  state: JsonModalState;
  onClose: () => void;
}) {
  const { title, exportData, parseLevel, onApply } = state;
  const exportJson = JSON.stringify(exportData, null, 2);

  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [exportCopied, setExportCopied] = useState(false);

  function handleCopyExport() {
    navigator.clipboard.writeText(exportJson).then(() => {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    });
  }

  function handleApplyImport() {
    setImportError(null);
    let parsed: unknown;
    try { parsed = JSON.parse(importText); }
    catch { setImportError('Invalid JSON — check your syntax.'); return; }
    try {
      let result;
      if (parseLevel === 'statue') result = parseStatue(parsed);
      else if (parseLevel === 'kind') result = parseKind(parsed);
      else result = parseAll(parsed);
      onApply(result as never);
      onClose();
    } catch (e) {
      setImportError((e as Error).message);
    }
  }

  const divider: React.CSSProperties = {
    border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0',
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: 24, width: 540, maxWidth: '95vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Export section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>Export</span>
            <button
              onClick={handleCopyExport}
              style={{
                fontSize: 12, padding: '3px 10px', borderRadius: 5, fontWeight: 600,
                background: exportCopied ? '#22c55e' : 'var(--accent)', color: '#fff',
                border: 'none', cursor: 'pointer', transition: 'background 0.2s',
              }}
            >
              {exportCopied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <textarea
            readOnly
            value={exportJson}
            rows={6}
            onFocus={e => e.target.select()}
            style={{
              fontFamily: 'monospace', fontSize: 11, resize: 'vertical',
              padding: '8px 10px', border: '1px solid var(--border)',
              borderRadius: 6, background: 'var(--bg)', color: 'var(--text)',
            }}
          />
        </div>

        <hr style={divider} />

        {/* Import section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>Import</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{PARSE_HINT[parseLevel]}</span>
          </div>
          <textarea
            value={importText}
            onChange={e => { setImportText(e.target.value); setImportError(null); }}
            placeholder="Paste JSON here…"
            rows={6}
            style={{
              fontFamily: 'monospace', fontSize: 11, resize: 'vertical',
              padding: '8px 10px',
              border: `1px solid ${importError ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: 6, background: 'var(--bg)', color: 'var(--text)',
            }}
          />
          {importError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{importError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13, background: 'var(--surface2)', color: 'var(--text)', border: 'none', cursor: 'pointer' }}
            >Cancel</button>
            <button
              onClick={handleApplyImport}
              disabled={!importText.trim()}
              style={{
                padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 700,
                background: importText.trim() ? 'var(--accent)' : 'var(--surface2)',
                color: importText.trim() ? '#fff' : 'var(--muted)',
                border: 'none', cursor: importText.trim() ? 'pointer' : 'default',
              }}
            >Apply Import</button>
          </div>
        </div>
      </div>
    </div>
  );
}
