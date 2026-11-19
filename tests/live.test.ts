// Live check against the real APIs: LIVE=1 LICHESS=<user> CHESSCOM=<user> npx vitest run tests/live.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Book, type BookData } from '../src/lib/book';
import { chesscomGames } from '../src/lib/chesscom';
import { lichessGames } from '../src/lib/lichess';
import { analyseOpening, moveNumber } from '../src/lib/openings';
import { buildReport, commonContinuation, lossRate, score } from '../src/lib/report';
import type { Game } from '../src/lib/types';

const book = new Book(JSON.parse(readFileSync('public/book.json', 'utf8')) as BookData);
const live = process.env.LIVE ? describe : describe.skip;
const pct = (x: number) => `${Math.round(x * 100)}%`;

async function show(label: string, gen: AsyncGenerator<Game>) {
  const t0 = Date.now();
  const games: Game[] = [];
  for await (const g of gen) games.push(g);
  const t1 = Date.now();
  const r = buildReport(games.map((g) => analyseOpening(g, book)));
  console.log(`\n== ${label}: ${games.length} games, fetch ${t1 - t0} ms, analyse ${Date.now() - t1} ms, min ${r.minGames}`);
  for (const o of r.openings.slice(0, 8))
    console.log(`  ${o.color} ${o.family.padEnd(28)} n=${String(o.n).padStart(3)} score=${pct(score(o))} diff=${pct(o.diff)} exit≈move ${moveNumber(o.avgExitPly)}`);
  if (r.best) console.log(`  BEST: ${r.best.family} (${r.best.color}) ${pct(r.best.diff)}`);
  if (r.leak)
    console.log(`  LEAK: ${r.leak.stat.family} (${r.leak.stat.color}) move ${moveNumber(r.leak.exitPly)} by ${r.leak.exitBy}, line lost ${pct(lossRate(r.leak.lineTally))} of ${r.leak.lineTally.n}: ${commonContinuation(r.leak).join(' ')}`);
  expect(games.length).toBeGreaterThan(0);
}

live('live import', () => {
  it('lichess', () => show('lichess', lichessGames(process.env.LICHESS ?? 'german11', { max: 300 })), 120_000);
  it('chess.com', () => show('chess.com', chesscomGames(process.env.CHESSCOM ?? 'hikaru', { max: 300 })), 120_000);
});
