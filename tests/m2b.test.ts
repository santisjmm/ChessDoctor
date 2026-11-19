import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Book, type BookData } from '../src/lib/book';
import type { DrillItem, GameReview } from '../src/lib/db';
import { analyseOpening } from '../src/lib/openings';
import { accuracyOverTime, fixState } from '../src/lib/progress';
import { classify, drops, moveAccuracy, summarise } from '../src/lib/review';
import type { Game } from '../src/lib/types';

const book = new Book(JSON.parse(readFileSync('public/book.json', 'utf8')) as BookData);
let seq = 0;
const game = (color: 'w' | 'b', playedAt: number, moves: string): Game => ({
  id: `t:${seq++}`, site: 'lichess', user: 'me', color, score: 0, playedAt, speed: 'blitz', rated: true, opponent: 'x', moves: moves.split(' '), url: '',
});

describe('review maths', () => {
  it('scores move accuracy like Lichess', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0);
    expect(moveAccuracy(10)).toBeCloseTo(63.4, 0);
    expect(moveAccuracy(100)).toBe(0);
  });
  it('classifies drops', () => {
    expect(classify(0)).toBe('best');
    expect(classify(3)).toBe('good');
    expect(classify(6)).toBe('inaccuracy');
    expect(classify(12)).toBe('mistake');
    expect(classify(30)).toBe('blunder');
  });
  it('only counts the user’s moves and finds the first real mistake', () => {
    // positions 0..4; White's moves at plies 0 and 2; Black's at 1 and 3.
    const cps = [20, 25, 20, -300, -280];
    const d = drops(cps, 'b');
    expect(d[0]).toBeNull();
    expect(d[2]).toBeNull();
    expect(d[1]).toBeCloseTo(0, 0); // 25 -> 20 is good for Black
    expect(d[3]).toBeCloseTo(1.4, 1); // -300 -> -280: Black gives back a little
    const s = summarise([20, 25, 300, 290, 290], 'b', 0);
    expect(s.firstMistakePly).toBe(1);
    expect(s.accuracy).toBeLessThan(80);
  });
});

describe('progress', () => {
  it('detects a fixed mistake from later games', () => {
    const item: DrillItem = {
      id: 'b|e4 c5 Nf3 d6', kind: 'mistake', color: 'b', family: 'Sicilian Defense', line: ['e4', 'c5', 'Nf3', 'd6'], focusPly: 3,
      played: 'Qa5', games: 4, createdAt: 1000, box: 0, due: 0, reps: 0, lapses: 0,
    };
    const items = [
      game('b', 500, 'e4 c5 Nf3 Qa5'), // before the drill existed: ignored
      game('b', 2000, 'e4 c5 Nf3 Qa5'),
      game('b', 3000, 'e4 c5 Nf3 d6'),
      game('w', 4000, 'e4 c5 Nf3 Qa5'), // other colour: ignored
    ].map((g) => analyseOpening(g, book));
    expect(fixState(item, items)).toMatchObject({ status: 'fixed', later: 2, repeated: 1 });
    expect(fixState(item, items.slice(0, 2))).toMatchObject({ status: 'repeating' });
    expect(fixState(item, items.slice(0, 1))).toMatchObject({ status: 'untested', later: 0 });
  });
  it('buckets accuracy by month, skipping thin buckets', () => {
    const r = (y: number, m: number, d: number, acc: number): GameReview => ({
      id: `${y}${m}${d}${acc}`, v: 1, playedAt: new Date(y, m, d).getTime(), color: 'w', cps: [], best: [], accuracy: acc, firstMistake: null,
    });
    const pts = accuracyOverTime([r(2026, 0, 3, 80), r(2026, 0, 9, 90), r(2026, 3, 1, 70), r(2026, 5, 2, 60), r(2026, 5, 20, 70)]);
    expect(pts.map((p) => [p.accuracy, p.n])).toEqual([[85, 2], [65, 2]]);
  });
});
