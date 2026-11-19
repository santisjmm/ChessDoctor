import 'fake-indexeddb/auto';
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Book, type BookData } from '../src/lib/book';
import { db } from '../src/lib/db';
import type { Engine, EngineResult } from '../src/lib/engine';
import { fullReview } from '../src/lib/gr/fullreview';
import type { Game } from '../src/lib/types';

const book = new Book(JSON.parse(readFileSync('public/book.json', 'utf8')) as BookData);

/** Fake engine: material after the move and the opponent's best capture reply (2 plies). */
const V = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 } as const;
const materialCp = (c: Chess) => {
  let cp = 0;
  for (const row of c.board()) for (const s of row) if (s) cp += (s.color === 'w' ? 1 : -1) * V[s.type];
  return cp;
};
const fake = {
  calls: 0,
  async analyse(fen: string): Promise<EngineResult> {
    this.calls++;
    const c = new Chess(fen);
    const sign = c.turn() === 'w' ? 1 : -1;
    const scored = c.moves({ verbose: true }).map((m) => {
      const a = new Chess(fen);
      a.move(m);
      const replies = a.moves({ verbose: true }).filter((r) => r.captured);
      const worst = replies.length ? Math.max(...replies.map((r) => V[r.captured!])) : 0;
      return { m, cp: materialCp(a) - sign * worst };
    });
    scored.sort((x, y) => sign * (y.cp - x.cp));
    const lines = scored.slice(0, 2).map(({ m, cp }) => ({ move: m.from + m.to + (m.promotion ?? ''), cp, mate: null, pv: [m.from + m.to] }));
    return { bestmove: lines[0].move, cp: lines[0].cp, mate: null, depth: 12, pv: lines[0].pv, lines };
  },
} as unknown as Engine & { calls: number };

const game = (moves: string): Game => ({
  id: `t:${moves.length}`, site: 'lichess', user: 'me', color: 'w', score: 0, playedAt: 1, speed: 'blitz', rated: true, opponent: 'x', moves: moves.split(' '), url: '',
});

describe('full review', () => {
  // White hangs the queen on move 4 (Qh5?? Nxh5 is not possible; use Qxf7+?? Kxf7).
  const g = game('e4 e5 Qh5 Nc6 Qxf7+ Kxf7 Nf3 d6 d4 Nf6');
  it('classifies every ply, marks book moves and the blunder, and computes stats', async () => {
    const r = await fullReview(fake, g, book);
    expect(r.plies).toHaveLength(10);
    expect(r.plies[0].classification).toBe('book'); // 1.e4
    expect(r.plies[4].color).toBe('w');
    expect(['mistake', 'blunder']).toContain(r.plies[4].classification); // Qxf7+?? loses the queen
    expect(r.keyMoments).toContain(4);
    expect(r.white.accuracy).not.toBeNull();
    expect(r.white.accuracy!).toBeLessThan(r.black.accuracy!);
    expect(r.rating.w.rating).toBeNull(); // fewer than 8 moves
    expect(r.fens).toHaveLength(11);
  });
  it('is cached on the device', async () => {
    const before = fake.calls;
    const again = await fullReview(fake, g, book);
    expect(fake.calls).toBe(before);
    expect(again.plies).toHaveLength(10);
    expect(await db.fullReviews.count()).toBe(1);
  });
});
