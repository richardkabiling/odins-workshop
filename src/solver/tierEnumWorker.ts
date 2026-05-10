// src/solver/tierEnumWorker.ts
// Web Worker entry point for tier-scenario enumeration.
// Vite bundles this as a separate worker chunk via the `new URL(...)` pattern.
import { feasibilityPrecheck, buildScenarioModel, lpRelaxationUpperBound } from './tierEnumModel';
import { solve } from './glpk';
import type { ScenarioRequest, ScenarioResponse } from './workerPool';

self.onmessage = async (e: MessageEvent<ScenarioRequest>) => {
  const { scenarioId, ta, td, pool, statWeights, attackNormFactors, defenseNormFactors, incumbent } = e.data;

  // (1) Fast feasibility precheck — no solver needed
  if (!feasibilityPrecheck(ta, td, pool)) {
    self.postMessage({ scenarioId, kind: 'feasibility-skip' } satisfies ScenarioResponse);
    return;
  }

  const model = buildScenarioModel(ta, td, pool, statWeights, attackNormFactors, defenseNormFactors);

  // (2) LP relaxation upper bound — skip MIP if LP ≤ incumbent
  const lpUB = await lpRelaxationUpperBound(model);
  if (lpUB === null || lpUB <= incumbent) {
    self.postMessage({ scenarioId, kind: 'lp-skip', lpUB: lpUB ?? -Infinity } satisfies ScenarioResponse);
    return;
  }

  // (3) Full MIP solve
  let mipResult;
  try {
    mipResult = await solve(model);
  } catch (err) {
    self.postMessage({ scenarioId, kind: 'error', message: String(err) } satisfies ScenarioResponse);
    return;
  }

  if (mipResult.result.status !== 5) {
    self.postMessage({ scenarioId, kind: 'mip-infeasible' } satisfies ScenarioResponse);
    return;
  }

  self.postMessage({
    scenarioId,
    kind: 'mip-optimal',
    score: mipResult.result.z,
    vars: mipResult.result.vars,
    ta,
    td,
  } satisfies ScenarioResponse);
};
