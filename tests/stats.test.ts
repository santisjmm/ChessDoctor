import { describe, expect, it } from 'vitest';
import type { GameOpening } from '../src/lib/openings';
import { byColor, byRatingDiff, bySpeed, expectedScore, ratingPools, ratingSeries } from '../src/lib/stats';
import type { Game } from '../src/lib/types';

let seq = 0;
const it_ = (o: Partial<Game>): GameOpening => ({
  game: { id: `t${seq++}`, site: 'lichess', user: 'me', color: 'w', score: 1, playedAt: Date.UTC(2026, 0, 1 + seq), speed: 'blitz', rated: true, opponent: 'x', moves: [], url: '', ...o },
  opening: null, exitPly: 0, exitBy: null, sans: [],
});

describe('stats', () => {
  const items = [
    it_({ speed: 'blitz', score: 1, userRating: 1500, oppRating: 1300 }),
    it_({ speed: 'blitz', score: 0, userRating: 1490, oppRating: 1700, color: 'b' }),
    it_({ speed: 'bullet', score: 0.5, userRating: 1400, oppRating: 1450 }),
    it_({ speed: 'blitz', score: 1, userRating: 1505, oppRating: 1550, site: 'chesscom' }),
  ];
  it('groups by speed in a fixed order and by colour', () => {
    expect(bySpeed(items).map((s) => [s.speed, s.tally.n])).toEqual([['bullet', 1], ['blitz', 3]]);
    expect(byColor(items).b.losses).toBe(1);
  });
  it('builds a daily rating series per site and speed', () => {
    expect(ratingSeries(items, 'lichess', 'blitz').map((p) => p.rating)).toEqual([1500, 1490]);
    expect(ratingPools(items, 1)[0]).toEqual({ site: 'lichess', speed: 'blitz', n: 2 });
  });
  it('compares score by rating difference with the Elo expectation', () => {
    expect(expectedScore(0)).toBe(0.5);
    expect(expectedScore(400)).toBeCloseTo(1 / 11);
    const b = byRatingDiff(items);
    expect(b.map((x) => x.label)).toEqual(['200+ lower', 'Equal to 99 higher', '200+ higher']);
    expect(b[0].expected).toBeGreaterThan(0.7);
  });
});
