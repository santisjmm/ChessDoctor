import type { GameOpening } from './openings';
import type { Color } from './types';

export interface Tally {
  n: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
}
export const score = (t: Tally) => (t.n ? t.points / t.n : 0);
export const lossRate = (t: Tally) => (t.n ? t.losses / t.n : 0);

function tally(items: GameOpening[]): Tally {
  const t: Tally = { n: 0, points: 0, wins: 0, draws: 0, losses: 0 };
  for (const { game } of items) {
    t.n++;
    t.points += game.score;
    if (game.score === 1) t.wins++;
    else if (game.score === 0) t.losses++;
    else t.draws++;
  }
  return t;
}

export interface OpeningStat extends Tally {
  color: Color;
  family: string;
  /** Score minus the user's average score with this colour. */
  diff: number;
  avgExitPly: number;
  items: GameOpening[];
}

export interface Leak {
  stat: OpeningStat;
  /** SAN line from the start through the first out-of-book move. */
  line: string[];
  /** The full path the leak's games follow (line + usual continuation). */
  path: string[];
  exitPly: number;
  exitBy: 'me' | 'opp';
  /** Games that followed `path` all the way. */
  lineTally: Tally;
  items: GameOpening[];
}

export interface Report {
  total: number;
  overall: Tally;
  byColor: Record<Color, Tally>;
  openings: OpeningStat[];
  best: OpeningStat | null;
  leak: Leak | null;
  /** Up to 3 leak candidates, worst first (the engine check may pick a later one). */
  leakCandidates: Leak[];
  minGames: number;
  firstPlayed: number;
  lastPlayed: number;
}

/** Fewest games an opening needs before it can be called "best" or a "leak". */
export function minGamesFor(total: number) {
  return Math.min(15, Math.max(5, Math.round(total * 0.04)));
}

const groupBy = <T>(xs: T[], k: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const key = k(x);
    const arr = m.get(key);
    if (arr) arr.push(x);
    else m.set(key, [x]);
  }
  return m;
};

/** Points lost compared with the user's own average: the size of a leak. */
const deficit = (t: Tally, baseline: number) => t.n * baseline - t.points;

export function buildReport(items: GameOpening[]): Report {
  const overall = tally(items);
  const byColor = {
    w: tally(items.filter((i) => i.game.color === 'w')),
    b: tally(items.filter((i) => i.game.color === 'b')),
  };
  const openings: OpeningStat[] = [];
  for (const [key, group] of groupBy(items, (i) => `${i.game.color}|${i.opening?.family ?? 'Unknown'}`)) {
    const [color, family] = key.split('|') as [Color, string];
    const t = tally(group);
    openings.push({
      ...t,
      color,
      family,
      diff: score(t) - score(byColor[color]),
      avgExitPly: group.reduce((s, i) => s + i.exitPly, 0) / group.length,
      items: group,
    });
  }
  openings.sort((a, b) => b.n - a.n);

  const minGames = minGamesFor(items.length);
  const named = openings.filter((o) => o.family !== 'Unknown');
  const eligible = (min: number) => named.filter((o) => o.n >= min);
  let pool = eligible(minGames);
  if (pool.length < 2) pool = eligible(3);

  const best = [...pool].filter((o) => o.diff > 0).sort((a, b) => b.diff - a.diff || b.n - a.n)[0] ?? null;
  const leakCandidates = [...pool]
    .filter((o) => o.diff < 0 && o !== best)
    .sort((a, b) => deficit(b, score(byColor[b.color])) - deficit(a, score(byColor[a.color])))
    .slice(0, 3)
    .map((o) => findLeakLine(o, score(byColor[o.color])))
    .filter((l): l is Leak => l !== null);

  const times = items.map((i) => i.game.playedAt);
  return {
    total: items.length,
    overall,
    byColor,
    openings,
    best,
    leak: leakCandidates[0] ?? null,
    leakCandidates,
    minGames,
    firstPlayed: Math.min(...times),
    lastPlayed: Math.max(...times),
  };
}

/**
 * Within a leaking opening, the line where the points go: walk down the move tree of the
 * user's games, at each step taking the branch that loses the most points against the
 * user's average, as long as enough games still follow it.
 */
export function findLeakLine(stat: OpeningStat, baseline: number, maxPlies = 24): Leak | null {
  const minSupport = Math.max(3, Math.ceil(stat.n * 0.15));
  let games = stat.items;
  const line: string[] = [];
  for (let ply = 0; ply < maxPlies; ply++) {
    const children = [...groupBy(games.filter((g) => g.sans.length > ply), (g) => g.sans[ply])]
      .map(([san, g]) => ({ san, g, t: tally(g) }))
      .filter((c) => c.t.n >= minSupport);
    if (!children.length) break;
    children.sort((a, b) => deficit(b.t, baseline) - deficit(a.t, baseline) || b.t.n - a.t.n);
    line.push(children[0].san);
    games = children[0].g;
  }
  // Then follow what these games usually did next, while at least 2 still agree.
  let path = games;
  for (let k = 0, ply = line.length; k < 8 && ply < maxPlies; k++, ply++) {
    const next = [...groupBy(path.filter((g) => g.sans.length > ply), (g) => g.sans[ply])].sort((a, b) => b[1].length - a[1].length)[0];
    if (!next || next[1].length < 2) break;
    line.push(next[0]);
    path = next[1];
  }
  // Where these games leave book: the most common exit inside the line.
  const exits = [...groupBy(games.filter((g) => g.exitBy && g.exitPly < line.length), (g) => String(g.exitPly))].sort(
    (a, b) => b[1].length - a[1].length,
  );
  if (!exits.length) return null;
  const exitPly = Number(exits[0][0]);
  const exitBy = exits[0][1][0].exitBy!;
  // Report the line up to the exit; the full path is the usual continuation.
  return { stat, line: line.slice(0, exitPly + 1), path: line, exitPly, exitBy, lineTally: tally(games), items: games };
}

/** The line the leak's games usually follow, through and past the book exit. */
export function commonContinuation(leak: Leak): string[] {
  return leak.path;
}

/** A position where the user chose a move, out of book, several times. */
export interface DecisionNode {
  color: Color;
  ply: number;
  line: string[]; // SAN from the start through the user's move
  san: string;
  items: GameOpening[];
  tally: Tally;
}

/**
 * The user's repeated out-of-book decisions in the first `maxPly` plies, most frequent first.
 * (Exact move order; transpositions count separately, which is fine at this depth.)
 */
export function decisionNodes(items: GameOpening[], minSupport: number, maxPly = 20, limit = 20): DecisionNode[] {
  const nodes = new Map<string, { color: Color; ply: number; line: string[]; items: GameOpening[] }>();
  for (const it of items) {
    const end = Math.min(it.sans.length, maxPly);
    for (let ply = it.exitPly; ply < end; ply++) {
      if ((ply % 2 === 0 ? 'w' : 'b') !== it.game.color) continue;
      const line = it.sans.slice(0, ply + 1);
      const key = `${it.game.color}|${line.join(' ')}`;
      const n = nodes.get(key);
      if (n) n.items.push(it);
      else nodes.set(key, { color: it.game.color, ply, line, items: [it] });
    }
  }
  return [...nodes.values()]
    .filter((n) => n.items.length >= minSupport)
    .map((n) => ({ ...n, san: n.line[n.ply], tally: tally(n.items) }))
    .sort((a, b) => b.tally.n - a.tally.n || a.ply - b.ply)
    .slice(0, limit);
}

/** Builds a Leak around one decision node (the repeated move the engine dislikes). */
export function leakFromNode(node: DecisionNode, report: Report): Leak {
  const fam = [...groupBy(node.items, (i) => i.opening?.family ?? 'Unknown')].sort((a, b) => b[1].length - a[1].length)[0][0];
  const stat = report.openings.find((o) => o.color === node.color && o.family === fam)!;
  const path = [...node.line];
  let games = node.items;
  for (let ply = path.length; ply < node.ply + 7; ply++) {
    const next = [...groupBy(games.filter((g) => g.sans.length > ply), (g) => g.sans[ply])].sort((a, b) => b[1].length - a[1].length)[0];
    if (!next || next[1].length < 2) break;
    path.push(next[0]);
    games = next[1];
  }
  const exitPly = Math.min(...node.items.map((i) => i.exitPly));
  return {
    stat,
    line: node.line,
    path,
    exitPly,
    exitBy: (exitPly % 2 === 0 ? 'w' : 'b') === node.color ? 'me' : 'opp',
    lineTally: node.tally,
    items: node.items,
  };
}

export { deficit };
