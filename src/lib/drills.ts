import { Chess } from 'chess.js';
import { db, type DrillItem } from './db';
import { explain } from './gr/explain';
import type { FullReview } from './gr/fullreview';
import { winPctFor } from './gr/winprob';
import { LEAK_DROP, type MoveVerdict } from './leakcheck';
import type { GameOpening } from './openings';
import { plyColor } from './openings';
import { reasonFor } from './reason';
import type { DecisionNode } from './report';
import { schedule } from './srs';
import { buildTree, type TreeNode } from './tree';
import type { Color } from './types';

export const drillId = (color: Color, line: string[]) => `${color}|${line.join(' ')}`;

const familyOfItems = (items: GameOpening[]) => {
  const count = new Map<string, number>();
  for (const i of items) if (i.opening) count.set(i.opening.family, (count.get(i.opening.family) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';
};

export function verdictReason(v: MoveVerdict, color: Color): string {
  return reasonFor({
    fenBefore: v.fenBefore, ply: v.ply, color, played: v.played, best: v.best,
    cpBest: v.cpBefore, cpPlayed: v.cpAfter, mateAfterPlayed: v.mateAfter, replyPv: v.replyPv,
  });
}

/** A drill for a repeated mistake: the line up to it, finishing with the better move. */
export function mistakeDrill(node: DecisionNode, v: MoveVerdict, now = Date.now()): DrillItem {
  const line = [...node.line.slice(0, node.ply), v.best];
  return {
    id: drillId(node.color, line), kind: 'mistake', color: node.color, family: familyOfItems(node.items),
    opening: node.items.find((i) => i.opening)?.opening?.name, line, focusPly: node.ply, played: v.played,
    reason: verdictReason(v, node.color), games: node.tally.n, createdAt: now, box: 0, due: now, reps: 0, lapses: 0,
  };
}

/** The user's most-played line with one colour, through their last move while ≥3 games agree. */
export function mainLineDrill(items: GameOpening[], color: Color, now = Date.now(), maxPly = 16): DrillItem | null {
  const root = buildTree(items, color, maxPly);
  const line: string[] = [];
  let node: TreeNode | undefined = root;
  let last: TreeNode | null = null;
  while ((node = node.children[0]) && node.n >= 3) {
    line.push(node.san);
    last = node;
  }
  while (line.length && plyColor(line.length - 1) !== color) line.pop();
  if (!last || line.filter((_, i) => plyColor(i) === color).length < 2) return null;
  const games = items.filter((i) => i.game.color === color && line.every((s, k) => i.sans[k] === s));
  return {
    id: drillId(color, line), kind: 'line', color, family: familyOfItems(games), opening: last.opening ?? undefined,
    line, focusPly: -1, games: games.length, createdAt: now, box: 0, due: now, reps: 0, lapses: 0,
  };
}

/** Adds new drills and refreshes the facts of existing ones, keeping their schedule. */
export async function upsertDrills(fresh: DrillItem[]) {
  if (!fresh.length) return;
  const existing = await db.drills.bulkGet(fresh.map((d) => d.id));
  await db.drills.bulkPut(
    fresh.map((d, i) => {
      const e = existing[i];
      return e ? { ...d, createdAt: e.createdAt, box: e.box, due: e.due, reps: e.reps, lapses: e.lapses, lastAt: e.lastAt } : d;
    }),
  );
}

export function drillsFromVerdicts(pairs: { node: DecisionNode; v: MoveVerdict }[]): DrillItem[] {
  return pairs.filter(({ node, v }) => v.drop >= LEAK_DROP && node.tally.n >= 2).map(({ node, v }) => mistakeDrill(node, v));
}

/** Records a finished drill run and reschedules it. */
export async function recordAttempt(item: DrillItem, misses: number) {
  const success = misses === 0;
  const at = Date.now();
  await db.transaction('rw', db.drills, db.attempts, async () => {
    await db.attempts.add({ itemId: item.id, at, success, misses });
    await db.drills.put(schedule(item, success, at));
  });
}

// --- Puzzles from fully reviewed games ("My mistakes") ------------------------------------

/** Moves within 2% win chance of the best count as solving a position puzzle. */
export const PUZZLE_ACCEPT_DROP = 2;

export function positionDrill(review: FullReview, ply: number, family: string, now = Date.now()): DrillItem {
  const fen = review.fens[ply];
  const lines = review.positions[ply].lines;
  const color = review.plies[ply].color;
  const best = lines[0];
  const winBest = winPctFor(best.eval, color);
  const accept = lines.filter((l) => winBest - winPctFor(l.eval, color) <= PUZZLE_ACCEPT_DROP).map((l) => l.move);
  const played = review.sans[ply];
  const m = new Chess(fen).move(played);
  const uci = m.from + m.to + (m.promotion ?? '');
  const why = explain({
    fenBefore: fen, uci, classification: review.plies[ply].classification, reasons: review.plies[ply].reasons,
    best: { move: best.move, pv: best.pv, eval: best.eval }, replyPv: review.positions[ply + 1]?.lines[0]?.pv ?? [], evalAfter: review.evals[ply + 1],
  });
  return {
    id: `p|${fen.split(' ').slice(0, 4).join(' ')}`, kind: 'position', color, family, line: [], focusPly: ply, played,
    reason: why.detail, games: 1, fen, accept, best: best.move, gameId: review.id,
    createdAt: now, box: 0, due: now, reps: 0, lapses: 0,
  };
}

/** Every mistake, blunder and miss by `color` in a reviewed game, as puzzles. */
export function positionDrillsFrom(review: FullReview, color: 'w' | 'b', family: string): DrillItem[] {
  return review.plies
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.color === color && ['mistake', 'blunder', 'miss'].includes(p.classification) && review.positions[i].lines.length > 0)
    .map(({ i }) => positionDrill(review, i, family));
}
