// Evaluation -> win probability. Ported from the Review app (backend/review/analysis/winprob.py).
// Evals are White's point of view: { cp } or { mate } (signed moves to mate; 0 = mated on the
// board, with `winner`).
import type { Color } from '../types';

export interface Eval {
  cp: number | null;
  mate: number | null;
  winner?: Color;
}
export const cpEval = (cp: number): Eval => ({ cp, mate: null });
export const mateEval = (mate: number, winner?: Color): Eval => ({ cp: null, mate, winner });

const WIN_COEFF = 0.00368208;
const EVAL_CLAMP_CP = 1000;
const MATE_CP = 1000;

export function winPctCp(cp: number): number {
  const c = Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_COEFF * c)) - 1);
}

export function whiteWinPct(ev: Eval): number {
  if (ev.mate !== null) {
    if (ev.mate === 0) return ev.winner === 'w' ? 100 : 0;
    return ev.mate > 0 ? 100 : 0;
  }
  return winPctCp(ev.cp ?? 0);
}

export const winPctFor = (ev: Eval, color: Color) => (color === 'w' ? whiteWinPct(ev) : 100 - whiteWinPct(ev));

export function whiteCp(ev: Eval): number {
  if (ev.mate !== null) {
    if (ev.mate === 0) return ev.winner === 'w' ? MATE_CP : -MATE_CP;
    return ev.mate > 0 ? MATE_CP : -MATE_CP;
  }
  return Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, Math.trunc(ev.cp ?? 0)));
}
export const cpFor = (ev: Eval, color: Color) => (color === 'w' ? whiteCp(ev) : -whiteCp(ev));

export function formatEval(ev: Eval): string {
  if (ev.mate !== null) {
    if (ev.mate === 0) return ev.winner === 'w' ? '1-0' : '0-1';
    return ev.mate > 0 ? `M${ev.mate}` : `-M${-ev.mate}`;
  }
  const v = (ev.cp ?? 0) / 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}
