import { useState, useEffect, useCallback, useRef } from 'react';
import type { Inventory, Solution, Failure } from './domain/types';
import { type StatRanking, DEFAULT_RANKING } from './domain/ranking';
import { optimize } from './solver/optimize';
import { InventoryForm } from './ui/InventoryForm';
import { StatRankerControls } from './ui/StatRankerControls';
import { ResultsView } from './ui/ResultsView';
import { SimulatorView } from './ui/SimulatorView';
import { encodeUrlState, decodeUrlState, encodeSimState, decodeSimState } from './lib/urlState';
import type { SimStatue } from './ui/SimulatorView';
import { makeEmptyStatues } from './ui/SimulatorView';

const DEFAULT_INVENTORY: Inventory = { perFeather: {} };

export default function App() {
  // Bootstrap from URL on first render
  const initialParams = new URLSearchParams(window.location.search);
  const initialTab = initialParams.get('tab') === 'optimize' ? 'optimize' : 'simulate';
  const initialUrl = decodeUrlState(window.location.search);
  const initialSimUrl = decodeSimState(window.location.search);
  const initialRanking = initialUrl?.ranking ?? DEFAULT_RANKING;

  const [tab, setTab] = useState<'optimize' | 'simulate'>(initialTab);

  // Optimizer state
  const [inventory, setInventory] = useState<Inventory>(initialUrl?.inventory ?? DEFAULT_INVENTORY);
  const [ranking, setRanking] = useState<StatRanking>(initialRanking);
  const [loading, setLoading] = useState(false);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [solvedRanking, setSolvedRanking] = useState<StatRanking>(initialRanking);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [formKey, setFormKey] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Simulator state (lifted for URL sync)
  const [simInventory, setSimInventory] = useState<Inventory>(initialSimUrl?.inventory ?? DEFAULT_INVENTORY);
  const [simFormKey, setSimFormKey] = useState(0);
  const [attackStatues, setAttackStatues] = useState<SimStatue[]>(
    (initialSimUrl?.attack as SimStatue[] | undefined) ?? makeEmptyStatues(),
  );
  const [defenseStatues, setDefenseStatues] = useState<SimStatue[]>(
    (initialSimUrl?.defense as SimStatue[] | undefined) ?? makeEmptyStatues(),
  );

  // ── URL helpers ──────────────────────────────────────────────────────────

  function pushOptimizeUrl(qs: string) {
    window.history.pushState({}, '', `?tab=optimize&${qs}`);
  }

  function replaceSimUrl(
    inv: Inventory,
    atk: SimStatue[],
    def: SimStatue[],
  ) {
    const qs = encodeSimState({ inventory: inv, attack: atk as never, defense: def as never });
    window.history.replaceState({}, '', `?${qs}`);
  }

  const runOptimize = useCallback(async (inv: Inventory, r: StatRanking) => {
    setLoading(true);
    setFailure(null);
    setSolution(null);
    try {
      const result = await optimize(inv, r);
      if (result.ok) {
        setSolution(result.solution);
        setSolvedRanking(r);
        setFailure(null);
      } else if (result.reason === 'inventory') {
        setFailure({ kind: 'inventory', diagnostics: result.diagnostics });
      } else {
        setFailure({ kind: 'generic', message: result.message ?? 'No feasible solution found.' });
      }
    } catch (e) {
      setFailure({ kind: 'generic', message: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run optimize if URL already has state on initial load
  useEffect(() => {
    if (initialUrl) {
      runOptimize(initialUrl.inventory, initialRanking).then(() => {
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOptimize() {
    const qs = encodeUrlState({ inventory, ranking });
    pushOptimizeUrl(qs);
    await runOptimize(inventory, ranking);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function handleClear() {
    window.history.pushState({}, '', `?tab=optimize`);
    setInventory(DEFAULT_INVENTORY);
    setRanking(DEFAULT_RANKING);
    setSolvedRanking(DEFAULT_RANKING);
    setSolution(null);
    setFailure(null);
    setFormKey(k => k + 1);
  }

  function handleSimClear() {
    const emptyAtk = makeEmptyStatues();
    const emptyDef = makeEmptyStatues();
    setSimInventory(DEFAULT_INVENTORY);
    setAttackStatues(emptyAtk);
    setDefenseStatues(emptyDef);
    setSimFormKey(k => k + 1);
    window.history.replaceState({}, '', '?tab=simulate');
  }

  function handleSimInventoryChange(inv: Inventory) {
    setSimInventory(inv);
    replaceSimUrl(inv, attackStatues, defenseStatues);
  }

  function handleAttackChange(next: SimStatue[]) {
    setAttackStatues(next);
    replaceSimUrl(simInventory, next, defenseStatues);
  }

  function handleDefenseChange(next: SimStatue[]) {
    setDefenseStatues(next);
    replaceSimUrl(simInventory, attackStatues, next);
  }

  function handleTabChange(newTab: 'optimize' | 'simulate') {
    setTab(newTab);
    if (newTab === 'optimize') {
      window.history.pushState({}, '', `?tab=optimize`);
    } else {
      replaceSimUrl(simInventory, attackStatues, defenseStatues);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1>Odin's Workshop</h1>
        <p style={{ color: 'var(--muted)', marginTop: 2, fontSize: 13 }}>Community Tools</p>
      </header>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {(['simulate', 'optimize'] as const).map(t => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--accent)' : 'var(--muted)',
              cursor: 'pointer',
              marginBottom: -2,
              borderRadius: 0,
              transition: 'color 0.12s',
            }}
          >
            {t === 'optimize' ? 'Optimize Feathers' : 'Simulate Feathers'}
          </button>
        ))}
      </div>

      {/* Optimize tab */}
      {tab === 'optimize' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>
            <InventoryForm key={formKey} inventory={inventory} onChange={setInventory} onClear={handleClear} />
            <div style={{ position: 'sticky', top: 16 }}>
              <div className="card">
                <StatRankerControls
                  ranking={ranking}
                  onChange={setRanking}
                  onOptimize={handleOptimize}
                  loading={loading}
                />
              </div>
            </div>
          </div>

          {(solution || failure) && (
            <div ref={resultsRef} style={{ marginTop: 32 }}>
              <ResultsView
                solution={solution}
                failure={failure}
              />
            </div>
          )}
        </>
      )}

      {/* Simulate tab */}
      {tab === 'simulate' && (
        <SimulatorView
          inventory={simInventory}
          onInventoryChange={handleSimInventoryChange}
          onInventoryClear={handleSimClear}
          invFormKey={simFormKey}
          attackStatues={attackStatues}
          defenseStatues={defenseStatues}
          onAttackChange={handleAttackChange}
          onDefenseChange={handleDefenseChange}
        />
      )}
    </div>
  );
}

