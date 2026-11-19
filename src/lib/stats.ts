// Results statistics from the games on the device.
import type { GameOpening } from './openings';
import type { Tally } from './report';
import type { Site } from './types';

const tally = (items: GameOpening[]): Tally => {
  const t: Tally = { n: 0, points: 0, wins: 0, draws: 0, losses: 0 };
  for (const { game } of items) {
    t.n++;
    t.points += game.score;
    if (game.score === 1) t.wins++;
    else if (game.score === 0) t.losses++;
    else t.draws++;
  }
  return t;
};

const SPEED_ORDER = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'daily', 'correspondence', 'unknown'];

export function bySpeed(items: GameOpening[]): { speed: string; tally: Tally }[] {
  const m = new Map<string, GameOpening[]>();
  for (const it of items) m.set(it.game.speed, [...(m.get(it.game.speed) ?? []), it]);
  return [...m].map(([speed, g]) => ({ speed, tally: tally(g) })).sort((a, b) => SPEED_ORDER.indexOf(a.speed) - SPEED_ORDER.indexOf(b.speed));
}

export const byColor = (items: GameOpening[]) => ({
  w: tally(items.filter((i) => i.game.color === 'w')),
  b: tally(items.filter((i) => i.game.color === 'b')),
});

/** The user's rating after each day's last game, for one site and speed, oldest first. */
export function ratingSeries(items: GameOpening[], site: Site, speed: string): { day: number; rating: number; games: number }[] {
  const rows = items
    .filter((i) => i.game.site === site && i.game.speed === speed && i.game.userRating)
    .sort((a, b) => a.game.playedAt - b.game.playedAt);
  const byDay = new Map<number, { rating: number; games: number }>();
  for (const { game } of rows) {
    const d = new Date(game.playedAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const prev = byDay.get(day);
    byDay.set(day, { rating: game.userRating!, games: (prev?.games ?? 0) + 1 });
  }
  return [...byDay].map(([day, v]) => ({ day, ...v }));
}

/** Rating series worth charting: (site, speed) pairs with enough rated games, most games first. */
export function ratingPools(items: GameOpening[], min = 5): { site: Site; speed: string; n: number }[] {
  const m = new Map<string, number>();
  for (const { game } of items) if (game.userRating) m.set(`${game.site}|${game.speed}`, (m.get(`${game.site}|${game.speed}`) ?? 0) + 1);
  return [...m]
    .filter(([, n]) => n >= min)
    .map(([k, n]) => ({ site: k.split('|')[0] as Site, speed: k.split('|')[1], n }))
    .sort((a, b) => b.n - a.n);
}

/** Elo expected score for a rating difference (opponent minus you). */
export const expectedScore = (diff: number) => 1 / (1 + 10 ** (diff / 400));

export const DIFF_BUCKETS: [number, number, string][] = [
  [-Infinity, -200, '200+ lower'],
  [-200, -100, '100–199 lower'],
  [-100, 0, '1–99 lower'],
  [0, 100, 'Equal to 99 higher'],
  [100, 200, '100–199 higher'],
  [200, Infinity, '200+ higher'],
];

/** Score by opponent rating difference, with the Elo expectation for that bucket's games. */
export function byRatingDiff(items: GameOpening[]): { label: string; tally: Tally; expected: number }[] {
  const rated = items.filter((i) => i.game.userRating && i.game.oppRating);
  return DIFF_BUCKETS.map(([lo, hi, label]) => {
    const g = rated.filter((i) => {
      const d = i.game.oppRating! - i.game.userRating!;
      // Lower-rated buckets include their lower edge (-200 is "200+ lower"), higher ones their upper.
      return d < 0 ? d > lo && d <= hi : d >= lo && d < hi;
    });
    const expected = g.length ? g.reduce((s, i) => s + expectedScore(i.game.oppRating! - i.game.userRating!), 0) / g.length : 0;
    return { label, tally: tally(g), expected };
  }).filter((b) => b.tally.n > 0);
}
