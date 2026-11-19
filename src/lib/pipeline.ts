import { Chess } from 'chess.js';
import { loadBook } from './book';
import type { CardData } from './card';
import { Engine } from './engine';
import { importAccounts, siteName, type Account } from './importer';
import { judgeMove, LEAK_DROP, type MoveVerdict } from './leakcheck';
import { analyseOpening, moveNumber, type GameOpening } from './openings';
import { buildReport, decisionNodes, deficit, leakFromNode, lossRate, score, type DecisionNode, type Report } from './report';
import type { ImportProgress, Site } from './types';

export type Stage =
  | { kind: 'import'; sites: Partial<Record<Site, ImportProgress>> }
  | { kind: 'openings'; done: number; total: number }
  | { kind: 'engine'; done: number; total: number };

export interface ReportResult {
  accounts: Account[];
  report: Report;
  /** Leak line extended with what usually happened next. */
  leakLine: string[] | null;
  mistake: MoveVerdict | null;
  checked: MoveVerdict[];
  card: CardData;
}

let engine: Engine | null = null;
export const getEngine = () => (engine ??= new Engine());

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export async function runReport(
  accounts: Account[],
  max: number,
  onStage: (s: Stage) => void,
  signal?: AbortSignal,
): Promise<ReportResult> {
  const bookP = loadBook();
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

  const book = await bookP;
  const items: GameOpening[] = [];
  for (let i = 0; i < games.length; i++) {
    items.push(analyseOpening(games[i], book));
    if (i % 20 === 19) {
      onStage({ kind: 'openings', done: i + 1, total: games.length });
      await yieldToUi();
    }
  }
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
    const own = verdicts.find(({ node }) => node.line.join(' ').startsWith(report.leak!.line.join(' ')));
    if (own) checked = [own.v];
  }
  return { accounts, report, leakLine, mistake, checked, card: cardData(accounts, report, mistake, checked, leakLine) };
}

/** Games that reached the position before `ply` along `line`. */
function reachedCount(items: GameOpening[], line: string[], ply: number) {
  return items.filter((g) => line.slice(0, ply).every((san, i) => g.sans[i] === san)).length;
}

export const moveLabel = (ply: number, san: string) => `${moveNumber(ply)}${ply % 2 === 0 ? '.' : '...'}${san}`;

const month = (t: number) => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

function cardData(accounts: Account[], r: Report, mistake: MoveVerdict | null, checked: MoveVerdict[], line: string[] | null): CardData {
  const names = [...new Set(accounts.map((a) => a.user.trim()))];
  const period = month(r.firstPlayed) === month(r.lastPlayed) ? month(r.lastPlayed) : `${month(r.firstPlayed)} – ${month(r.lastPlayed)}`;
  const leak = r.leak;
  let verdict: CardData['verdict'] = null;
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
    const c = new Chess();
    for (const san of line.slice(0, leak.exitPly)) c.move(san);
    const mv = c.move(line[leak.exitPly]);
    verdict = {
      fen: c.fen(), orientation: leak.stat.color, played: moveLabel(leak.exitPly, mv.san), best: null,
      playedUci: mv.from + mv.to, bestUci: null,
    };
  }
  return {
    name: names.join(' · '),
    subtitle: `${accounts.map((a) => siteName(a.site)).join(' + ')} · ${r.total.toLocaleString('en')} games · ${period}`,
    best: r.best && { family: r.best.family, color: r.best.color, diff: r.best.diff, score: score(r.best), n: r.best.n },
    leak: leak && {
      family: leak.stat.family,
      color: leak.stat.color,
      moveNo: moveNumber(shown?.ply ?? leak.exitPly),
      n: mistake ? leak.lineTally.n : leak.stat.n,
      score: mistake ? score(leak.lineTally) : score(leak.stat),
      lossRate: mistake ? lossRate(leak.lineTally) : lossRate(leak.stat),
      diff: mistake ? score(leak.lineTally) - score(r.byColor[leak.stat.color]) : leak.stat.diff,
      drop: mistake ? mistake.drop : null,
      reached: reachedCount(leak.stat.items, line ?? leak.path, shown?.ply ?? leak.exitPly),
    },
    verdict,
  };
}
