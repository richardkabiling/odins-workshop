import { useState, useEffect, useCallback, useRef } from 'react';
import type { Inventory, Solution, Failure } from './domain/types';
import { type StatRanking, DEFAULT_RANKING } from './domain/ranking';
import { optimize } from './solver/optimize';
import { InventoryForm } from './ui/InventoryForm';
import { StatRankerControls } from './ui/StatRankerControls';
import { ResultsView } from './ui/ResultsView';
import { encodeUrlState, decodeUrlState } from './lib/urlState';

const DEFAULT_INVENTORY: Inventory = { perFeather: {} };

export default function App() {
  // Bootstrap from URL on first render
  const initialUrl = decodeUrlState(window.location.search);
  const initialRanking = initialUrl?.ranking ?? DEFAULT_RANKING;

  const [inventory, setInventory] = useState<Inventory>(initialUrl?.inventory ?? DEFAULT_INVENTORY);
  const [ranking, setRanking] = useState<StatRanking>(initialRanking);
  const [loading, setLoading] = useState(false);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [solvedRanking, setSolvedRanking] = useState<StatRanking>(initialRanking);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Key to force-remount InventoryForm when clearing (flushes local raw state)
  const [formKey, setFormKey] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

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
    window.history.pushState({}, '', `?${qs}`);
    await runOptimize(inventory, ranking);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function handleClear() {
    window.history.pushState({}, '', window.location.pathname);
    setInventory(DEFAULT_INVENTORY);
    setRanking(DEFAULT_RANKING);
    setSolvedRanking(DEFAULT_RANKING);
    setSolution(null);
    setFailure(null);
    setFormKey(k => k + 1);
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1>ROOC Feather Optimizer</h1>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          Optimizes your Ragnarok Origin Classic feather statue setup given a Tier-1 feather inventory.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
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
            ranking={solvedRanking}
          />
        </div>
      )}
    </div>
  );
}

