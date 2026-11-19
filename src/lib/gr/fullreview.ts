// Full game review on the device: one MultiPV-2 search per position (cached), then the Review
// app's classification, calibrated accuracy and Game Rating for both players.
import { Chess } from 'chess.js';
import { fenKey, type Book } from '../book';
import { db } from '../db';
import type { Engine, EngineResult, SearchLimits } from '../engine';
import { cachedEval } from '../leakcheck';
import type { Color, Game } from '../types';
import { sideStats, volatilityWeights, type SideStats } from './accuracy';
import { classifyPly, KEY_MOMENT_CLASSES, type Line, type PlyResult } from './classify';
import { estimateRating, type GameRating } from './rating';
import { cpEval, mateEval, whiteWinPct, type Eval } from './winprob';

export const FULL_REVIEW_VERSION = 2; // 2: sacrifice must put new material en prise
export const FULL_LIMITS: SearchLimits = { depth: 12, movetime: 700, multipv: 2 };
/** Longest game reviewed (plies); later moves are left out to keep phones cool. */
export const MAX_REVIEW_PLIES = 160;

export interface StoredPosition {
  lines: Line[]; // best first, White POV evals
}

export interface FullReview {
  id: string; // game id
  v: number;
  depth: number;
  sans: string[];
  fens: string[]; // positions 0..n
  positions: StoredPosition[]; // engine lines per position (empty for finished positions)
  evals: Eval[]; // eval of each position (best line / terminal)
  plies: PlyResult[];
  white: SideStats;
  black: SideStats;
  rating: Record<Color, GameRating>;
  keyMoments: number[]; // ply indices
  truncated: boolean;
}

function terminalEval(c: Chess): Eval | null {
  if (c.isCheckmate()) return mateEval(0, c.turn() === 'w' ? 'b' : 'w');
  if (c.isStalemate() || c.isInsufficientMaterial() || c.isThreefoldRepetition() || c.isDraw()) return cpEval(0);
  return null;
}

const toEval = (cp: number, mate: number | null): Eval => (mate !== null ? mateEval(mate) : cpEval(cp));

function linesOf(r: EngineResult): Line[] {
  const ls = r.lines?.length ? r.lines : [{ move: r.bestmove, cp: r.cp, mate: r.mate, pv: r.pv }];
  return ls.filter((l) => l.move).map((l) => ({ move: l.move, eval: toEval(l.cp, l.mate), pv: l.pv.slice(0, 10) }));
}

export async function fullReview(
  engine: Engine,
  game: Game,
  book: Book,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<FullReview> {
  const cached = await db.fullReviews.get(game.id).catch(() => undefined);
  if (cached && cached.v === FULL_REVIEW_VERSION) return cached;

  const chess = new Chess();
  const sans: string[] = [];
  const fens = [chess.fen()];
  for (const m of game.moves.slice(0, MAX_REVIEW_PLIES)) {
    try {
      sans.push(chess.move(m).san);
    } catch {
      break;
    }
    fens.push(chess.fen());
  }
  const positions: StoredPosition[] = [];
  const evals: Eval[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const c = new Chess(fens[i]);
    const term = terminalEval(c);
    if (term && i > 0) {
      positions.push({ lines: [] });
      evals.push(term);
    } else {
      const r = await cachedEval(engine, fens[i], FULL_LIMITS);
      const lines = linesOf(r);
      positions.push({ lines });
      evals.push(lines[0]?.eval ?? cpEval(0));
    }
    onProgress?.(i + 1, fens.length);
  }

  // Classify every ply.
  const plies: PlyResult[] = [];
  let stillBook = true;
  const hist = new Chess();
  for (let i = 0; i < sans.length; i++) {
    const mv = hist.move(sans[i]);
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    const inBook = stillBook && book.has(fenKey(fens[i + 1]));
    if (!inBook) stillBook = false;
    const lines = positions[i].lines.length ? positions[i].lines : [{ move: uci, eval: evals[i + 1], pv: [uci] }];
    plies.push(
      classifyPly(
        { fenBefore: fens[i], uci, lastMoveTo: i > 0 ? lastTo(fens[i - 1], sans[i - 1]) : undefined, lines, evalAfter: evals[i + 1], inBook },
        plies[i - 1] ?? null,
      ),
    );
  }

  // Accuracy per side, weighted by how sharp the position was.
  const whiteWins = [whiteWinPct(evals[0]), ...plies.map((p) => (p.color === 'w' ? p.winAfter : 100 - p.winAfter))];
  const weights = volatilityWeights(whiteWins);
  const side = (c: Color) => {
    const idx = plies.map((p, i) => (p.color === c ? i : -1)).filter((i) => i >= 0);
    return sideStats(idx.map((i) => plies[i]), idx.map((i) => weights[i]));
  };
  const white = side('w'), black = side('b');
  const rating = (s: SideStats): GameRating =>
    s.accuracy === null || s.acpl === null
      ? { rating: null, low: null, high: null }
      : estimateRating({ accuracy: s.accuracy, acpl: s.acpl, moves: s.moves, timeClass: game.speed, blunders: s.counts.blunder, mistakes: s.counts.mistake, misses: s.counts.miss });

  const review: FullReview = {
    id: game.id, v: FULL_REVIEW_VERSION, depth: FULL_LIMITS.depth, sans, fens, positions, evals, plies, white, black,
    rating: { w: rating(white), b: rating(black) },
    keyMoments: plies.map((p, i) => (KEY_MOMENT_CLASSES.has(p.classification) ? i : -1)).filter((i) => i >= 0),
    truncated: game.moves.length > sans.length,
  };
  await db.fullReviews.put(review).catch(() => undefined);
  return review;
}

function lastTo(fen: string, san: string): string | undefined {
  try {
    return new Chess(fen).move(san).to;
  } catch {
    return undefined;
  }
}
