import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Book, type BookData } from '../src/lib/book';
import { db, type DrillItem } from '../src/lib/db';
import { mainLineDrill, recordAttempt, upsertDrills } from '../src/lib/drills';
import { analyseOpening } from '../src/lib/openings';
import { evalWords, reasonFor } from '../src/lib/reason';
import { INTERVALS_DAYS, RELEARN_MS, schedule, streak, todaysSession } from '../src/lib/srs';
import { buildTree, findNode, tone } from '../src/lib/tree';
import type { Game } from '../src/lib/types';

const book = new Book(JSON.parse(readFileSync('public/book.json', 'utf8')) as BookData);
const DAY = 86_400_000;
let seq = 0;
const game = (color: 'w' | 'b', score: 1 | 0.5 | 0, moves: string): Game => ({
  id: `t:${seq++}`, site: 'lichess', user: 'me', color, score, playedAt: seq, speed: 'blitz', rated: true, opponent: 'x', moves: moves.split(' '), url: '',
});
const item = (over: Partial<DrillItem> = {}): DrillItem => ({
  id: `w|${seq++}`, kind: 'mistake', color: 'w', family: 'X', line: ['e4'], focusPly: 0, games: 3, createdAt: 0, box: 0, due: 0, reps: 0, lapses: 0, ...over,
});

describe('srs', () => {
  it('moves up a box on a clean run and resets on a slip', () => {
    const now = 1_000_000;
    const a = schedule(item(), true, now);
    expect(a.box).toBe(1);
    expect(a.due).toBe(now + INTERVALS_DAYS[1] * DAY);
    const b = schedule({ ...a, box: 4 }, true, now);
    expect(b.box).toBe(5);
    expect(schedule(b, true, now).box).toBe(5); // capped
    const c = schedule(b, false, now);
    expect(c).toMatchObject({ box: 0, due: now + RELEARN_MS, lapses: 1 });
  });
  it('counts a streak up to today or yesterday', () => {
    const now = new Date(2026, 10, 19, 12).getTime();
    const d = (k: number) => new Date(2026, 10, 19 - k, 9).getTime();
    expect(streak([d(0), d(1), d(2), d(4)], now)).toBe(3);
    expect(streak([d(1), d(2)], now)).toBe(2); // not trained yet today: still alive
    expect(streak([d(2)], now)).toBe(0);
    expect(streak([], now)).toBe(0);
  });
  it('builds today’s session: due mistakes first, then one line', () => {
    const now = 10 * DAY;
    const items = [
      item({ due: now - 5, games: 2 }),
      item({ due: now + DAY }), // not due
      item({ kind: 'line', due: now - 1, games: 9 }),
      item({ kind: 'line', due: now - 1, games: 3 }),
      ...Array.from({ length: 10 }, () => item({ due: now - 100 })),
    ];
    const s = todaysSession(items, now, 8);
    expect(s).toHaveLength(8);
    expect(s.filter((i) => i.kind === 'line')).toHaveLength(1);
    expect(s.at(-1)!.games).toBe(9);
    expect(s.every((i) => i.due <= now)).toBe(true);
  });
});

describe('tree', () => {
  const games = [
    ...Array.from({ length: 4 }, () => game('w', 1, 'd4 d5 Bf4 Nf6 e3')),
    game('w', 0, 'd4 d5 Bf4 c5 e3'),
    game('w', 0, 'e4 e5 Nf3'),
    game('b', 1, 'e4 c5 Nf3'),
  ];
  const items = games.map((g) => analyseOpening(g, book));
  const root = buildTree(items, 'w');
  it('aggregates per move and sorts by games', () => {
    expect(root.n).toBe(6);
    expect(root.children.map((c) => c.san)).toEqual(['d4', 'e4']);
    const bf4 = findNode(root, ['d4', 'd5', 'Bf4'])!;
    expect(bf4).toMatchObject({ n: 5, wins: 4, losses: 1, inBook: true });
    expect(bf4.opening).toMatch(/London System/);
    expect(findNode(root, ['d4', 'e5'])).toBeNull();
  });
  it('colours by score against the baseline', () => {
    const base = root.points / root.n;
    expect(tone(findNode(root, ['d4'])!, base)).toBe('win');
    expect(tone(findNode(root, ['e4'])!, base)).toBe('few');
  });
});

describe('reasons', () => {
  it('describes evals from the user’s side', () => {
    expect(evalWords(20, 'w')).toBe('about equal');
    expect(evalWords(-150, 'w')).toBe('worse for you (−1.5)');
    expect(evalWords(-150, 'b')).toBe('better for you (+1.5)');
  });
  it('names a lost piece', () => {
    // 1.g3 d5 2.Bg2 Bh3?? 3.Bxh3 wins the bishop.
    const r = reasonFor({
      fenBefore: 'rnbqkbnr/ppp1pppp/8/3p4/8/6P1/PPPPPPBP/RNBQK1NR b KQkq - 1 2', ply: 3, color: 'b', played: 'Bh3', best: 'e5',
      cpBest: 30, cpPlayed: 350, mateAfterPlayed: null, replyPv: ['Bxh3', 'e5', 'd3'],
    });
    expect(r).toBe('After 2...Bh3, White plays 3.Bxh3 and wins your bishop. 2...e5 avoids it.');
  });
  it('falls back to the evaluation', () => {
    const r = reasonFor({
      fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ply: 1, color: 'b', played: 'f6', best: 'e5',
      cpBest: 30, cpPlayed: 120, mateAfterPlayed: null, replyPv: ['d4', 'e5'],
    });
    expect(r).toBe('1...e5 keeps it about equal; after 1...f6 it is worse for you (−1.2).');
  });
});

describe('drills', () => {
  const games = [
    ...Array.from({ length: 5 }, () => game('w', 1, 'd4 d5 Bf4 Nf6 e3 e6 Nf3')),
    game('w', 0, 'e4 e5'),
  ];
  const items = games.map((g) => analyseOpening(g, book));
  it('makes the most-played line into a drill ending on the user’s move', () => {
    const d = mainLineDrill(items, 'w')!;
    expect(d.line).toEqual(['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3']);
    expect(d.kind).toBe('line');
    expect(d.games).toBe(5);
    expect(mainLineDrill(items, 'b')).toBeNull();
  });
  it('keeps the schedule when a drill is refreshed, and records attempts', async () => {
    const d = mainLineDrill(items, 'w')!;
    await upsertDrills([d]);
    await recordAttempt((await db.drills.get(d.id))!, 0);
    const after = (await db.drills.get(d.id))!;
    expect(after.box).toBe(1);
    await upsertDrills([{ ...d, games: 6 }]);
    const refreshed = (await db.drills.get(d.id))!;
    expect(refreshed).toMatchObject({ box: 1, games: 6, reps: 1 });
    expect(await db.attempts.where('itemId').equals(d.id).count()).toBe(1);
  });
});
