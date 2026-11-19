import type { Game } from './types';
import { politeFetch, type PoliteOptions } from './polite';

interface ChesscomPlayer {
  username: string;
  rating?: number;
  result: string;
}
export interface ChesscomGame {
  url: string;
  pgn?: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  initial_setup?: string;
  white: ChesscomPlayer;
  black: ChesscomPlayer;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

/** SAN moves from a PGN's movetext (comments, NAGs, variations, move numbers stripped). */
export function pgnMoves(pgn: string): string[] {
  let text = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, ''); // tags
  text = text.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  while (/\([^()]*\)/.test(text)) text = text.replace(/\([^()]*\)/g, ' ');
  return text
    .replace(/\$\d+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, '').replace(/[?!]+$/, ''))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t) && !/^\d+\.*$/.test(t));
}

export function parseChesscomGame(d: ChesscomGame, username: string): Game | null {
  const u = username.toLowerCase();
  if (d.rules !== 'chess' || !d.pgn) return null;
  if (d.initial_setup && d.initial_setup !== START) return null;
  const white = d.white.username.toLowerCase() === u;
  const black = d.black.username.toLowerCase() === u;
  if (white === black) return null;
  const me = white ? d.white : d.black;
  const opp = white ? d.black : d.white;
  const score = me.result === 'win' ? 1 : DRAWS.has(me.result) ? 0.5 : 0;
  const moves = pgnMoves(d.pgn);
  if (moves.length === 0) return null;
  const id = d.url.split('/').pop() ?? d.url;
  return {
    id: `chesscom:${id}`,
    site: 'chesscom',
    user: u,
    color: white ? 'w' : 'b',
    score,
    playedAt: d.end_time * 1000,
    speed: d.time_class,
    rated: d.rated,
    userRating: me.rating,
    oppRating: opp.rating,
    opponent: opp.username,
    moves,
    url: d.url,
  };
}

const API = 'https://api.chess.com/pub/player';

/**
 * Walks the monthly archives newest-first until `max` games (or `since`) is reached.
 * One request at a time; past months are immutable, so callers can cache them.
 */
export async function* chesscomGames(
  username: string,
  opts: { max: number; since?: number } & PoliteOptions,
): AsyncGenerator<Game> {
  const u = encodeURIComponent(username.toLowerCase());
  const res = await politeFetch(`${API}/${u}/games/archives`, opts);
  const { archives } = (await res.json()) as { archives: string[] };
  let n = 0;
  for (const url of [...archives].reverse()) {
    const month = (await (await politeFetch(url, opts)).json()) as { games: ChesscomGame[] };
    const games = month.games.sort((a, b) => b.end_time - a.end_time);
    for (const raw of games) {
      if (opts.since && raw.end_time * 1000 <= opts.since) return;
      const g = parseChesscomGame(raw, username);
      if (!g) continue;
      yield g;
      if (++n >= opts.max) return;
    }
  }
}
