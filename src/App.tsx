import { useState, useEffect, useCallback, useRef } from 'react';
import type { Inventory, Solution, Failure, OptimizerMode, TierEnumProgress, OptimizeOptions } from './domain/types';
import { type StatRanking, DEFAULT_RANKING } from './domain/ranking';
import { optimize } from './solver/optimize';
import { InventoryForm } from './ui/InventoryForm';
import { StatRankerControls } from './ui/StatRankerControls';
import { ResultsView } from './ui/ResultsView';
import { SimulatorView } from './ui/SimulatorView';
import { CompareView } from './ui/CompareView';
import { encodeUrlState, decodeUrlState, encodeSimState, decodeSimState, encodeCompareState, decodeCompareState } from './lib/urlState';
import type { CompareSetup } from './lib/urlState';
import type { SimStatue } from './ui/SimulatorView';
import { makeEmptyStatues } from './ui/SimulatorView';
import type { Clipboard } from './ui/clipboard';
import { ClipboardWidget } from './ui/clipboard';

const DEFAULT_INVENTORY: Inventory = { perFeather: {} };

export default function App() {
  // Bootstrap from URL on first render
  const initialParams = new URLSearchParams(window.location.search);
  const rawTab = initialParams.get('tab');
  const initialTab: 'optimize' | 'simulate' | 'compare' =
    rawTab === 'optimize' ? 'optimize' : rawTab === 'compare' ? 'compare' : 'simulate';
  const initialUrl = decodeUrlState(window.location.search);
  const initialSimUrl = decodeSimState(window.location.search);
  const initialCmpUrl = decodeCompareState(window.location.search);
  const initialRanking = initialUrl?.ranking ?? DEFAULT_RANKING;

  const [tab, setTab] = useState<'optimize' | 'simulate' | 'compare'>(initialTab);

  // Optimizer state
  const [inventory, setInventory] = useState<Inventory>(initialUrl?.inventory ?? DEFAULT_INVENTORY);
  const [ranking, setRanking] = useState<StatRanking>(initialRanking);
  const [mode, setMode] = useState<OptimizerMode>('greedy');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<TierEnumProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [solution, setSolution] = useState<Solution | null>(null);
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

  // Clipboard (shared across Simulate + Compare tabs)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);

  // Compare state
  const [compareSetups, setCompareSetups] = useState<CompareSetup[]>(
    initialCmpUrl?.setups ?? [
      makeEmptySetup('Setup A'),
      makeEmptySetup('Setup B'),
    ],
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

  const runOptimize = useCallback(async (inv: Inventory, r: StatRanking, m: OptimizerMode) => {
    // Abort any in-flight run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setProgress(null);
    setFailure(null);
    setSolution(null);
    try {
      const opts: OptimizeOptions = {
        signal: controller.signal,
        onProgress: m === 'tier-enum' ? setProgress : undefined,
      };
      const result = await optimize(inv, r, m, opts);
      if (controller.signal.aborted) return; // ignore results if cancelled
      if (result.ok) {
        setSolution(result.solution);
        setFailure(null);
      } else if (result.reason === 'inventory') {
        setFailure({ kind: 'inventory', diagnostics: result.diagnostics });
      } else {
        setFailure({ kind: 'generic', message: result.message ?? 'No feasible solution found.' });
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setFailure({ kind: 'generic', message: String(e) });
      }
    } finally {
      setLoading(false);
      setProgress(null);
      abortControllerRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Abort on unmount
  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  // Auto-run optimize if URL already has state on initial load
  useEffect(() => {
    if (initialUrl) {
      runOptimize(initialUrl.inventory, initialRanking, 'greedy').then(() => {
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOptimize() {
    const qs = encodeUrlState({ inventory, ranking });
    pushOptimizeUrl(qs);
    await runOptimize(inventory, ranking, mode);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function handleClear() {
    window.history.pushState({}, '', `?tab=optimize`);
    setInventory(DEFAULT_INVENTORY);
    setRanking(DEFAULT_RANKING);
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

  function replaceCompareUrl(setups: CompareSetup[]) {
    const qs = encodeCompareState({ setups: setups as never });
    window.history.replaceState({}, '', `?${qs}`);
  }

  function handleCompareSetupsChange(next: CompareSetup[]) {
    setCompareSetups(next);
    replaceCompareUrl(next);
  }

  function handleTabChange(newTab: 'optimize' | 'simulate' | 'compare') {
    setTab(newTab);
    if (newTab === 'optimize') {
      window.history.pushState({}, '', `?tab=optimize`);
    } else if (newTab === 'compare') {
      replaceCompareUrl(compareSetups);
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
        {(['simulate', 'compare', 'optimize'] as const).map(t => (
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
            {t === 'optimize' ? 'Optimize Feathers' : t === 'simulate' ? 'Simulate Feathers' : 'Compare Feathers'}
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
                  mode={mode}
                  onModeChange={setMode}
                  progress={progress}
                  onCancel={mode === 'tier-enum' ? handleCancel : undefined}
                />
              </div>
            </div>
          </div>

          {(solution || failure) && (
            <div ref={resultsRef} style={{ marginTop: 32 }}>
              <ResultsView
                solution={solution}
                failure={failure}
                ranking={ranking}
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
          clipboard={clipboard}
          setClipboard={setClipboard}
        />
      )}

      {/* Compare tab */}
      {tab === 'compare' && (
        <CompareView
          setups={compareSetups}
          onSetupsChange={handleCompareSetupsChange}
          clipboard={clipboard}
          setClipboard={setClipboard}
        />
      )}

      {/* Shared floating clipboard widget */}
      {(tab === 'simulate' || tab === 'compare') && (
        <ClipboardWidget clipboard={clipboard} setClipboard={setClipboard} />
      )}
    </div>
  );
}

function makeEmptySetup(name: string): import('./lib/urlState').CompareSetup {
  return { name, attack: makeEmptyStatues() as never, defense: makeEmptyStatues() as never };
}

