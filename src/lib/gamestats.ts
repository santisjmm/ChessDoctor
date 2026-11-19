// Stats from whole-game reviews (Review-app style): accuracy, Game Rating vs actual rating,
// errors per 100 moves and where the evaluation is lost, by phase.
import { accuracyDrop, moveAccuracy } from './gr/accuracy';
import type { FullReview } from './gr/fullreview';
import { phasesForGame, type Phase } from './gr/phases';
import type { GameOpening } from './openings';

export interface ReviewedGame {
  item: GameOpening;
  review: FullReview;
}

export function reviewKpis(rows: ReviewedGame[]) {
  let moves = 0, acc = 0, accN = 0, gr = 0, grN = 0, grDiff = 0, grDiffN = 0;
  const c = { blunder: 0, mistake: 0, miss: 0, inaccuracy: 0 };
  for (const { item, review } of rows) {
    const s = item.game.color === 'w' ? review.white : review.black;
    moves += s.moves;
    if (s.accuracy != null) { acc += s.accuracy; accN++; }
    const r = review.rating[item.game.color].rating;
    if (r) {
      gr += r; grN++;
      if (item.game.userRating) { grDiff += r - item.game.userRating; grDiffN++; }
    }
    c.blunder += s.counts.blunder; c.mistake += s.counts.mistake; c.miss += s.counts.miss; c.inaccuracy += s.counts.inaccuracy;
  }
  const per100 = (x: number) => (moves ? (x / moves) * 100 : null);
  return {
    games: rows.length, moves,
    accuracy: accN ? acc / accN : null,
    gameRating: grN ? Math.round(gr / grN / 10) * 10 : null,
    vsActual: grDiffN ? Math.round(grDiff / grDiffN) : null,
    blunders: per100(c.blunder), mistakes: per100(c.mistake), misses: per100(c.miss), inaccuracies: per100(c.inaccuracy),
  };
}

/** Win% lost per move, accuracy and share of the loss, per phase (the user's moves). */
export function lossByPhase(rows: ReviewedGame[]) {
  const agg: Record<Phase, { drop: number; n: number; acc: number }> = { opening: { drop: 0, n: 0, acc: 0 }, middlegame: { drop: 0, n: 0, acc: 0 }, endgame: { drop: 0, n: 0, acc: 0 } };
  for (const { item, review } of rows) {
    const book = review.plies.findIndex((p) => p.classification !== 'book');
    const phases = phasesForGame(review.fens, book < 0 ? review.plies.length : book);
    review.plies.forEach((p, i) => {
      if (p.color !== item.game.color) return;
      const a = agg[phases[i]];
      a.drop += accuracyDrop(p);
      a.acc += moveAccuracy(accuracyDrop(p));
      a.n++;
    });
  }
  const total = Object.values(agg).reduce((s, a) => s + a.drop, 0);
  return (Object.keys(agg) as Phase[]).map((ph) => ({
    phase: ph, moves: agg[ph].n,
    lostPerMove: agg[ph].n ? agg[ph].drop / agg[ph].n : null,
    accuracy: agg[ph].n ? agg[ph].acc / agg[ph].n : null,
    share: total ? agg[ph].drop / total : null,
  }));
}

/** One point per reviewed game, oldest first, with a rolling mean over `window` games. */
export function rolling<T>(rows: T[], value: (r: T) => number | null, window = 10): { row: T; value: number; avg: number }[] {
  const pts = rows.map((r) => ({ row: r, value: value(r) })).filter((p): p is { row: T; value: number } => p.value !== null);
  return pts.map((p, i) => {
    const seg = pts.slice(Math.max(0, i - window + 1), i + 1);
    return { ...p, avg: seg.reduce((s, x) => s + x.value, 0) / seg.length };
  });
}
