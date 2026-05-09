/**
 * Thin wrapper around glpk.js.
 * glpk.js is a WebAssembly port of the GLPK MIP solver.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — glpk.js ships its own types
import GLPK from 'glpk.js';

export type GlpkVarType = 'CV' | 'IV' | 'BV'; // continuous, integer, binary

export interface GlpkVar {
  name: string;
  coef: number;
}

export interface GlpkConstraint {
  name: string;
  vars: GlpkVar[];
  bnds: { type: number; ub: number; lb: number };
}

export interface GlpkModel {
  name: string;
  objective: { direction: number; name: string; vars: GlpkVar[] };
  subjectTo: GlpkConstraint[];
  binaries?: string[];
  generals?: string[];
}

export interface GlpkResult {
  result: {
    status: number;   // 5 = GLP_OPT (optimal)
    vars: Record<string, number>;
    z: number;
  };
}

let _glpk: Awaited<ReturnType<typeof GLPK>> | null = null;

export async function getGlpk() {
  if (!_glpk) _glpk = await GLPK();
  return _glpk;
}

export async function solve(model: GlpkModel): Promise<GlpkResult> {
  const glpk = await getGlpk();
  return glpk.solve(model, { msglev: glpk.GLP_MSG_OFF }) as unknown as GlpkResult;
}

/** Convenience: GLP bound type constants. Lazily set after first getGlpk(). */
export const BoundType = {
  FR: 1, // free
  LO: 2, // >= lb
  UP: 3, // <= ub
  DB: 4, // lb <= x <= ub
  FX: 5, // = lb = ub
} as const;
