// Game Rating: strength shown in one game, mapped near chess.com's scale (from game_rating.py,
// built-in mapping fitted on 20 of the owner's chess.com reviews). Our own estimate: single games
// typically differ from chess.com's by ~180 points.
export const MIN_MOVES = 8;
const RATING_MIN = 100, RATING_MAX = 3200;
const TIME_OFFSET: Record<string, number> = { ultraBullet: 150, bullet: 150, blitz: 75, rapid: 0, classical: -50, daily: -100, correspondence: -100 };
const MAP = { m: 940.0, beta: 0.7494, c: 1046.34, mae: 181.3 };

export const rAcc = (acc: number) => 3200 / (1 + Math.exp(-(acc - 80) / 13.9));
export const rAcpl = (acpl: number) => 3100 * Math.exp(-0.0167 * Math.max(0, acpl));

export interface RatingInput {
  accuracy: number;
  acpl: number;
  moves: number;
  timeClass: string;
  blunders: number;
  mistakes: number;
  misses: number;
}
export interface GameRating {
  rating: number | null;
  low: number | null;
  high: number | null;
}

const clampRound = (x: number) => Math.round(Math.max(RATING_MIN, Math.min(RATING_MAX, x)) / 10) * 10;

export function baseEstimate(s: RatingInput): number {
  const errRate = s.moves > 0 ? (s.blunders + s.misses + 0.5 * s.mistakes) / s.moves : 0;
  return (TIME_OFFSET[s.timeClass] ?? 0) + 0.5 * rAcc(s.accuracy) + 0.5 * rAcpl(s.acpl) - 0.4 * errRate * 1000;
}

export function estimateRating(s: RatingInput): GameRating {
  if (s.moves < MIN_MOVES) return { rating: null, low: null, high: null };
  const est = MAP.m + MAP.beta * (baseEstimate(s) - MAP.c);
  const sd = Math.max(120, 1.25 * MAP.mae);
  return { rating: clampRound(est), low: clampRound(est - sd), high: clampRound(est + sd) };
}
