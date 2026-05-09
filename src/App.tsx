import { useState, useEffect, useCallback, useRef } from 'react';
import type { Inventory, Solution, Failure } from './domain/types';
import { DEFAULT_RANKING, swapPvX } from './domain/ranking';
import { optimize } from './solver/optimize';
import { InventoryForm } from './ui/InventoryForm';
import { OptimizationControls } from './ui/OptimizationControls';
import { ResultsView } from './ui/ResultsView';
import { encodeUrlState, decodeUrlState } from './lib/urlState';

const DEFAULT_INVENTORY: Inventory = { perFeather: {} };

export default function App() {
  // Bootstrap from URL on first render
  const initialUrl = decodeUrlState(window.location.search);
  // Derive legacy UI controls from ranking (ratio not yet exposed in UI — use defaults)
  const initialRanking = initialUrl?.ranking ?? DEFAULT_RANKING;

  const [inventory, setInventory] = useState<Inventory>(initialUrl?.inventory ?? DEFAULT_INVENTORY);
  // TODO(Task 6): replace offensivePct state with ranking once StatRankerControls is wired
  const [offensivePct, setOffensivePct] = useState(70);
  const [pvp, setPvp] = useState(initialRanking.pvp);
  const [loading, setLoading] = useState(false);
  const [solution, setSolution] = useState<Solution | null>(null);
  // TODO(Task 6): replace solvedOffensivePct state with ranking once StatRankerControls is wired
  const [solvedOffensivePct, setSolvedOffensivePct] = useState(70);
  const [solvedPvp, setSolvedPvp] = useState(initialRanking.pvp);
  const [error, setError] = useState<string | null>(null);
  // Key to force-remount InventoryForm when clearing (flushes local raw state)
  const [formKey, setFormKey] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  const runOptimize = useCallback(async (inv: Inventory, _offPct: number, isPvp: boolean) => {
    setLoading(true);
    setError(null);
    setSolution(null);
    const ranking = { ...DEFAULT_RANKING, order: swapPvX(DEFAULT_RANKING.order, isPvp), pvp: isPvp };
    try {
      const result = await optimize(inv, ranking);
      if (result.ok) {
        setSolution(result.solution);
        setSolvedOffensivePct(_offPct);
        setSolvedPvp(isPvp);
      } else if (result.reason === 'inventory') {
        setError('Insufficient inventory: ' + result.diagnostics.map(d => `${d.kind} ${d.rarity} needs ${d.need}, have ${d.have}`).join('; '));
      } else {
        setError(result.message ?? 'No feasible solution. Check that you have enough feathers (at least 4 orange + 1 purple eligible for the chosen statue type).');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run optimize if URL already has state on initial load
  useEffect(() => {
    if (initialUrl) {
      runOptimize(initialUrl.inventory, offensivePct, initialRanking.pvp).then(() => {
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOptimize() {
    const qs = encodeUrlState({
      inventory,
      ranking: { ...DEFAULT_RANKING, pvp },
    });
    window.history.pushState({}, '', `?${qs}`);
    await runOptimize(inventory, offensivePct, pvp);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function handleClear() {
    window.history.pushState({}, '', window.location.pathname);
    setInventory(DEFAULT_INVENTORY);
    setOffensivePct(70);
    setPvp(false);
    setSolution(null);
    setError(null);
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
            <OptimizationControls
              atkPct={offensivePct}
              pvp={pvp}
              onAtkPctChange={setOffensivePct}
              onPvpChange={setPvp}
              onOptimize={handleOptimize}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {(solution || error) && (
        <div ref={resultsRef} style={{ marginTop: 32 }}>
          <ResultsView
            solution={solution}
            failure={error ? ({ kind: 'generic', message: error } satisfies Failure) : null}
            atkPct={solvedOffensivePct}
            pvp={solvedPvp}
          />
        </div>
      )}
    </div>
  );
}

