// Light game review: the opening phase of one game, an evaluation for every position,
// per-move accuracy for the user's moves and the first real mistake.
import { Chess } from 'chess.js';
import { db, type GameReview } from './db';
import { winPct, type Engine, type EngineResult } from './engine';
import { cachedEval, pvToSan, PHONE_LIMITS } from './leakcheck';
import { OPENING_PLIES, plyColor, type GameOpening } from './openings';
import { reasonFor } from './reason';

export const REVIEW_VERSION = 1;
/** Win% lost that counts as a real mistake (Lichess: 10%); 5% is an inaccuracy, 20% a blunder. */
export const MISTAKE_DROP = 10;

/** Lichess's per-move accuracy from the win% lost (0-100). */
export const moveAccuracy = (drop: number) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));

export type MoveClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export const classify = (drop: number): MoveClass =>
  drop >= 20 ? 'blunder' : drop >= MISTAKE_DROP ? 'mistake' : drop >= 5 ? 'inaccuracy' : drop <= 0.5 ? 'best' : 'good';

/** Win% each user move gave away, from consecutive evaluations (White POV cp, index = position). */
export function drops(cps: number[], color: 'w' | 'b'): (number | null)[] {
  return cps.slice(1).map((after, ply) => {
    if (plyColor(ply) !== color) return null;
    const s = color === 'w' ? 1 : -1;
    return Math.max(0, s * (winPct(cps[ply]) - winPct(after)));
  });
}

export function summarise(cps: number[], color: 'w' | 'b', exitPly: number) {
  const d = drops(cps, color);
  const mine = d.map((x, ply) => ({ x, ply })).filter((m): m is { x: number; ply: number } => m.x !== null);
  const accuracy = mine.length ? mine.reduce((s, m) => s + moveAccuracy(m.x), 0) / mine.length : null;
  const first = mine.find((m) => m.x >= MISTAKE_DROP && m.ply >= Math.min(exitPly, 1)) ?? null;
  return { drops: d, accuracy, firstMistakePly: first?.ply ?? null };
}

/** Reviews (or returns the cached review of) one game's opening phase. */
export async function reviewGame(
  engine: Engine,
  item: GameOpening,
  onProgress?: (done: number, total: number, partial: number[]) => void,
): Promise<GameReview> {
  const cached = await db.reviews.get(item.game.id).catch(() => undefined);
  if (cached && cached.v === REVIEW_VERSION) return cached;
  const sans = item.sans.slice(0, OPENING_PLIES);
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const s of sans) {
    chess.move(s);
    fens.push(chess.fen());
  }
  const results: EngineResult[] = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]);
    if (c.isGameOver()) {
      // Mate or stalemate on the board: no search needed.
      const cp = c.isCheckmate() ? (c.turn() === 'w' ? -10000 : 10000) : 0;
      results.push({ bestmove: '', cp, mate: c.isCheckmate() ? 0 : null, depth: 0, pv: [] });
    } else results.push(await cachedEval(engine, fens[i], PHONE_LIMITS));
    onProgress?.(i + 1, fens.length, results.map((r) => r.cp));
  }
  const cps = results.map((r) => r.cp);
  const { accuracy, firstMistakePly, drops: d } = summarise(cps, item.game.color, item.exitPly);
  let firstMistake: GameReview['firstMistake'] = null;
  if (firstMistakePly !== null) {
    const ply = firstMistakePly;
    const before = results[ply];
    const best = pvToSan(fens[ply], [before.bestmove], 1)[0] ?? before.bestmove;
    firstMistake = {
      ply,
      played: sans[ply],
      best,
      drop: d[ply]!,
      reason: reasonFor({
        fenBefore: fens[ply], ply, color: item.game.color, played: sans[ply], best,
        cpBest: before.cp, cpPlayed: cps[ply + 1], mateAfterPlayed: results[ply + 1].mate, replyPv: pvToSan(fens[ply + 1], results[ply + 1].pv),
      }),
    };
  }
  const review: GameReview = {
    id: item.game.id, v: REVIEW_VERSION, playedAt: item.game.playedAt, color: item.game.color,
    cps, best: results.map((r) => r.bestmove), accuracy, firstMistake,
  };
  await db.reviews.put(review).catch(() => undefined);
  return review;
}
