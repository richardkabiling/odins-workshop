import { useState } from 'react';
import type { Inventory, Solution } from './domain/types';
import { optimize } from './solver/optimize';
import { InventoryForm } from './ui/InventoryForm';
import { OptimizationControls } from './ui/OptimizationControls';
import { ResultsView } from './ui/ResultsView';

const DEFAULT_INVENTORY: Inventory = { perFeather: {} };

export default function App() {
  const [inventory, setInventory] = useState<Inventory>(DEFAULT_INVENTORY);
  const [atkPct, setAtkPct] = useState(70);
  const [pvp, setPvp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [solvedAtkPct, setSolvedAtkPct] = useState(70);
  const [solvedPvp, setSolvedPvp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOptimize() {
    setLoading(true);
    setError(null);
    setSolution(null);
    try {
      const result = await optimize(inventory, atkPct, pvp);
      if (result.ok) {
        setSolution(result.solution);
        setSolvedAtkPct(atkPct);
        setSolvedPvp(pvp);
      } else {
        setError(result.message ?? 'No feasible solution. Check that you have enough feathers (at least 4 orange + 1 purple eligible for the chosen statue type).');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
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
        <InventoryForm inventory={inventory} onChange={setInventory} />
        <div style={{ position: 'sticky', top: 16 }}>
          <div className="card">
            <OptimizationControls
              atkPct={atkPct}
              pvp={pvp}
              onAtkPctChange={setAtkPct}
              onPvpChange={setPvp}
              onOptimize={handleOptimize}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {(solution || error) && (
        <div style={{ marginTop: 32 }}>
          <ResultsView solution={solution} error={error} atkPct={solvedAtkPct} pvp={solvedPvp} />
        </div>
      )}
    </div>
  );
}
