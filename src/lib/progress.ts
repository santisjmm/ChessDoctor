import type { DrillItem, GameReview } from './db';
import type { GameOpening } from './openings';

export type FixStatus = 'fixed' | 'repeating' | 'untested';

export interface FixState {
  item: DrillItem;
  status: FixStatus;
  /** Later games (played after the drill was created) that reached the position. */
  later: number;
  repeated: number;
}

/**
 * Has the user stopped making a drilled mistake? Looks at games played after the drill was
 * created that reached the same position: fixed if the latest one avoided the old move.
 */
export function fixState(item: DrillItem, items: GameOpening[]): FixState {
  const prefix = item.line.slice(0, item.focusPly);
  const later = items
    .filter((i) => i.game.color === item.color && i.game.playedAt > item.createdAt && i.sans.length > item.focusPly)
    .filter((i) => prefix.every((s, k) => i.sans[k] === s))
    .sort((a, b) => a.game.playedAt - b.game.playedAt);
  const repeated = later.filter((i) => i.sans[item.focusPly] === item.played).length;
  const status: FixStatus = !later.length ? 'untested' : later.at(-1)!.sans[item.focusPly] === item.played ? 'repeating' : 'fixed';
  return { item, status, later: later.length, repeated };
}

export interface AccuracyPoint {
  start: number; // bucket start (ms)
  label: string;
  accuracy: number;
  n: number;
}

const DAY = 86_400_000;

/** Mean opening accuracy per week (short spans) or per month, oldest first. */
export function accuracyOverTime(reviews: GameReview[], minGames = 2): AccuracyPoint[] {
  const rs = reviews.filter((r) => r.accuracy !== null).sort((a, b) => a.playedAt - b.playedAt);
  if (!rs.length) return [];
  const weekly = rs.at(-1)!.playedAt - rs[0].playedAt <= 70 * DAY;
  const bucket = (t: number) => {
    const d = new Date(t);
    if (!weekly) return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    return monday.getTime();
  };
  const groups = new Map<number, number[]>();
  for (const r of rs) {
    const k = bucket(r.playedAt);
    groups.set(k, [...(groups.get(k) ?? []), r.accuracy!]);
  }
  return [...groups]
    .filter(([, a]) => a.length >= minGames)
    .map(([start, a]) => ({
      start,
      label: new Date(start).toLocaleDateString('en-GB', weekly ? { day: 'numeric', month: 'short' } : { month: 'short', year: '2-digit' }),
      accuracy: a.reduce((s, x) => s + x, 0) / a.length,
      n: a.length,
    }));
}
