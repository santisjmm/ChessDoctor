import { Chess } from 'chess.js';
import { loadBook } from './book';
import type { CardData } from './card';
import { getEngine } from './analysis';
import { db, type GameReview } from './db';
import { loadItems } from './library';
import { importAccounts, siteName, type Account } from './importer';
import { judgeMove, LEAK_DROP, type MoveVerdict } from './leakcheck';
import { moveNumber, plyColor, type GameOpening } from './openings';
import { buildReport, decisionNodes, deficit, leakFromNode, lossRate, score, type DecisionNode, type Report } from './report';
import type { ImportProgress, Site } from './types';

export type Stage =
  | { kind: 'import'; sites: Partial<Record<Site, ImportProgress>> }
  | { kind: 'openings'; done: number; total: number }
  | { kind: 'engine'; done: number; total: number };


export interface ReportResult {
  accounts: Account[];
  items: GameOpening[];
  report: Report;
  /** Leak line extended with what usually happened next. */
  leakLine: string[] | null;
  mistake: MoveVerdict | null;
  checked: MoveVerdict[];
  /** Every engine verdict computed for the report (seeds the background analysis). */
  verdicts: { node: DecisionNode; v: MoveVerdict }[];
  card: CardData;
}

/** Imports (incrementally) and builds the report. */
export async function runReport(
  accounts: Account[],
  max: number,
  onStage: (s: Stage) => void,
  signal?: AbortSignal,
): Promise<ReportResult> {
  loadBook();
  getEngine(); // start loading the WASM while we download
  const sites: Partial<Record<Site, ImportProgress>> = {};
  const games = await importAccounts(
    accounts,
    max,
    (p) => {
      sites[p.site] = p;
      onStage({ kind: 'import', sites: { ...sites } });
    },
    signal,
  );
  if (!games.length) throw new Error('No standard chess games found for that username.');
  return reportFromDevice(accounts, max, onStage);
}

/** Builds the report from games already on the device (no network; cached evals make it quick). */
export async function reportFromDevice(accounts: Account[], max: number, onStage: (s: Stage) => void): Promise<ReportResult> {
  const items = await loadItems(accounts, max, (done, total) => onStage({ kind: 'openings', done, total }));
  if (!items.length) throw new Error('No games on this device yet.');
  const report = buildReport(items);

  // Screen the user's repeated out-of-book moves with the engine; the leak is the repeated
  // inaccuracy that costs the most points. Falls back to the results-only leak.
  const nodes = decisionNodes(items, Math.max(3, Math.round(items.length * 0.02)));
  const verdicts: { node: DecisionNode; v: MoveVerdict }[] = [];
  onStage({ kind: 'engine', done: 0, total: nodes.length });
  for (const [k, node] of nodes.entries()) {
    verdicts.push({ node, v: await judgeMove(getEngine(), node.line, node.ply) });
    onStage({ kind: 'engine', done: k + 1, total: nodes.length });
  }
  const base = (c: 'w' | 'b') => score(report.byColor[c]);
  const bad = verdicts
    .filter(({ v }) => v.drop >= LEAK_DROP)
    .sort((a, b) => deficit(b.node.tally, base(b.node.color)) - deficit(a.node.tally, base(a.node.color)) || b.v.drop - a.v.drop);
  let mistake: MoveVerdict | null = null;
  let checked: MoveVerdict[] = [];
  let leakLine: string[] | null = report.leak?.path ?? null;
  if (bad.length) {
    report.leak = leakFromNode(bad[0].node, report);
    mistake = bad[0].v;
    leakLine = report.leak.path;
  } else if (report.leak) {
    // The engine's view of the user's own move in the leak line (same colour, same moves).
    const leak = report.leak;
    const own = verdicts.find(
      ({ node }) => node.color === leak.stat.color && leak.line.every((san, i) => node.line[i] === san),
    );
    if (own) checked = [own.v];
  }
  const checkedOpenings = (await db.reviews.bulkGet(items.map((i) => i.game.id)).catch(() => [])).filter((x) => x && x.accuracy !== null) as GameReview[];
  const card = { ...cardData(accounts, report, mistake, checked, leakLine), ...cardStats(items, report, checkedOpenings) };
  return { accounts, items, report, leakLine, mistake, checked, verdicts, card };
}

/** Games that reached the position before `ply` along `line`. */
function reachedCount(items: GameOpening[], line: string[], ply: number) {
  return items.filter((g) => line.slice(0, ply).every((san, i) => g.sans[i] === san)).length;
}

const SPEED_NAME: Record<string, string> = { ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', correspondence: 'Daily' };

function longestWinStreak(items: GameOpening[]): number {
  let best = 0, cur = 0;
  for (const { game } of [...items].sort((a, b) => a.game.playedAt - b.game.playedAt)) {
    cur = game.score === 1 ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** The numbers on the card: ratings, results, repertoire and a few opening facts. */
export function cardStats(items: GameOpening[], r: Report, checkedOpenings: GameReview[]): Pick<CardData, 'ratings' | 'results' | 'repertoire' | 'facts'> {
  const pools = new Map<string, { site: string; speed: string; now: number; peak: number; at: number; n: number }>();
  for (const { game } of items) {
    if (!game.userRating || game.site === 'pgn') continue;
    const k = `${game.site}|${game.speed}`;
    const p = pools.get(k) ?? { site: game.site, speed: game.speed, now: game.userRating, peak: game.userRating, at: 0, n: 0 };
    if (game.playedAt >= p.at) { p.now = game.userRating; p.at = game.playedAt; }
    p.peak = Math.max(p.peak, game.userRating);
    p.n++;
    pools.set(k, p);
  }
  const multiSite = new Set([...pools.values()].map((p) => p.site)).size > 1;
  const ratings = [...pools.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((p) => ({
    label: `${multiSite ? `${siteName(p.site as Site)} ` : ''}${SPEED_NAME[p.speed] ?? p.speed}`, now: p.now, peak: p.peak,
  }));
  const top = (c: 'w' | 'b') => r.openings.filter((o) => o.color === c && o.family !== 'Unknown').slice(0, 3).map((o) => ({ family: o.family, n: o.n, score: score(o), diff: o.diff }));
  const out = items.filter((i) => i.exitBy !== null);
  const rated = items.filter((i) => i.game.userRating && i.game.oppRating && i.game.oppRating - i.game.userRating >= 100);
  const vsStronger = rated.length >= 5 ? {
    n: rated.length,
    score: rated.reduce((s, i) => s + i.game.score, 0) / rated.length,
    expected: rated.reduce((s, i) => s + 1 / (1 + 10 ** ((i.game.oppRating! - i.game.userRating!) / 400)), 0) / rated.length,
  } : null;
  return {
    ratings,
    results: { n: r.overall.n, wins: r.overall.wins, draws: r.overall.draws, losses: r.overall.losses, score: score(r.overall), white: score(r.byColor.w), black: score(r.byColor.b) },
    repertoire: { w: top('w'), b: top('b') },
    facts: {
      bookExitMove: out.length ? Math.round((out.reduce((s, i) => s + i.exitPly, 0) / out.length / 2 + 1) * 10) / 10 : null,
      openingAccuracy: checkedOpenings.length >= 5 ? checkedOpenings.reduce((s, x) => s + x.accuracy!, 0) / checkedOpenings.length : null,
      openingAccuracyGames: checkedOpenings.length,
      vsStronger,
      winStreak: longestWinStreak(items),
    },
  };
}

export const moveLabel = (ply: number, san: string) => `${moveNumber(ply)}${ply % 2 === 0 ? '.' : '...'}${san}`;

const month = (t: number) => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

function cardData(accounts: Account[], r: Report, mistake: MoveVerdict | null, checked: MoveVerdict[], line: string[] | null): Omit<CardData, 'ratings' | 'results' | 'repertoire' | 'facts'> {
  const names = [...new Set(accounts.map((a) => a.user.trim()))];
  const period = month(r.firstPlayed) === month(r.lastPlayed) ? month(r.lastPlayed) : `${month(r.firstPlayed)} – ${month(r.lastPlayed)}`;
  const leak = r.leak;
  let verdict: CardData['verdict'] = null;
  let fallbackPly = -1;
  const shown = mistake ?? checked[0] ?? null;
  if (leak && shown) {
    verdict = {
      fen: shown.fenBefore,
      orientation: leak.stat.color,
      played: moveLabel(shown.ply, shown.played),
      best: mistake ? moveLabel(mistake.ply, mistake.best) : null,
      playedUci: shown.playedUci,
      bestUci: mistake ? mistake.bestUci : null,
    };
  } else if (leak && line) {
    // No engine verdict: show the user's own first move from the book exit on (never the opponent's).
    fallbackPly = line.findIndex((_, i) => i >= leak.exitPly && plyColor(i) === leak.stat.color);
    if (fallbackPly >= 0) {
      const c = new Chess();
      for (const san of line.slice(0, fallbackPly)) c.move(san);
      const fen = c.fen();
      const mv = c.move(line[fallbackPly]);
      verdict = {
        fen, orientation: leak.stat.color, played: moveLabel(fallbackPly, mv.san), best: null,
        playedUci: mv.from + mv.to, bestUci: null,
      };
    }
  }

  return {
    name: names.join(' · '),
    subtitle: `${accounts.map((a) => siteName(a.site)).join(' + ')} · ${r.total.toLocaleString('en')} games · ${period}`,
    best: r.best && { family: r.best.family, color: r.best.color, diff: r.best.diff, score: score(r.best), n: r.best.n },
    leak: leak && {
      family: leak.stat.family,
      color: leak.stat.color,
      moveNo: moveNumber(shown?.ply ?? (fallbackPly >= 0 ? fallbackPly : leak.exitPly)),
      n: mistake ? leak.lineTally.n : leak.stat.n,
      score: mistake ? score(leak.lineTally) : score(leak.stat),
      lossRate: mistake ? lossRate(leak.lineTally) : lossRate(leak.stat),
      diff: mistake ? score(leak.lineTally) - score(r.byColor[leak.stat.color]) : leak.stat.diff,
      drop: mistake ? mistake.drop : null,
      reached: reachedCount(leak.stat.items, line ?? leak.path, shown?.ply ?? (fallbackPly >= 0 ? fallbackPly : leak.exitPly)),
    },
    verdict,
  };
}
