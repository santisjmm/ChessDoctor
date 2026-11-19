// Per-player accuracy and ACPL, calibrated to chess.com's (from accuracy.py: fitted on the
// owner's chess.com-reviewed games, cross-validated error about 5 points).
import { CLASSES, type MoveClass, type PlyResult } from './classify';

const MOVE_A = 85.0, MOVE_B = 0.1005, MOVE_FLOOR = 15.0, MEAN_SHARE = 0.4;
export const VOL_MIN = 0.5, VOL_MAX = 12.0;
const ZERO_DROP = new Set<MoveClass>(['best', 'book', 'great', 'brilliant']);

export const moveAccuracy = (drop: number) => Math.max(0, Math.min(100, MOVE_A * Math.exp(-MOVE_B * Math.max(0, drop)) + MOVE_FLOOR));

export function gameAccuracy(moveAccs: number[], weights?: number[]): number {
  const vals = moveAccs.map((v) => Math.max(1, v));
  const w = weights && weights.length === vals.length ? weights : vals.map(() => 1);
  const weighted = vals.reduce((s, v, i) => s + v * w[i], 0) / w.reduce((a, b) => a + b, 0);
  const harmonic = vals.length / vals.reduce((s, v) => s + 1 / v, 0);
  return MEAN_SHARE * weighted + (1 - MEAN_SHARE) * harmonic;
}

export const accuracyDrop = (p: PlyResult) => (ZERO_DROP.has(p.classification) ? 0 : p.rawDrop);

const pstdev = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

/** Weight per ply: how much White's win% moves around it. `whiteWins` = before ply 0, then after each ply. */
export function volatilityWeights(whiteWins: number[]): number[] {
  const n = whiteWins.length - 1;
  const window = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const seg = whiteWins.slice(Math.max(0, i - window + 1), i + 2);
    const sd = seg.length > 1 ? pstdev(seg) : VOL_MIN;
    out.push(Math.min(VOL_MAX, Math.max(VOL_MIN, sd)));
  }
  return out;
}

export interface SideStats {
  moves: number;
  accuracy: number | null;
  acpl: number | null;
  counts: Record<MoveClass, number>;
}

export function sideStats(plies: PlyResult[], weights?: number[]): SideStats {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<MoveClass, number>;
  for (const p of plies) counts[p.classification]++;
  if (!plies.length) return { moves: 0, accuracy: null, acpl: null, counts };
  return {
    moves: plies.length,
    accuracy: Math.round(gameAccuracy(plies.map((p) => moveAccuracy(accuracyDrop(p))), weights) * 10) / 10,
    acpl: Math.round((plies.reduce((s, p) => s + p.cpl, 0) / plies.length) * 10) / 10,
    counts,
  };
}
