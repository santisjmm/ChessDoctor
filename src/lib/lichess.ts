import type { Game } from './types';
import { politeFetch, type PoliteOptions } from './polite';

interface LichessPlayer {
  user?: { name: string; id: string };
  rating?: number;
  aiLevel?: number;
}
export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
  moves?: string;
  initialFen?: string;
}

const SKIP_STATUS = new Set(['aborted', 'noStart', 'unknownFinish', 'created', 'started']);

export function parseLichessGame(d: LichessGame, username: string): Game | null {
  const u = username.toLowerCase();
  if (d.variant !== 'standard' || d.initialFen || SKIP_STATUS.has(d.status) || !d.moves) return null;
  const white = d.players.white.user?.id === u;
  const black = d.players.black.user?.id === u;
  if (white === black) return null;
  const me = white ? d.players.white : d.players.black;
  const opp = white ? d.players.black : d.players.white;
  const color = white ? 'w' : 'b';
  const score = !d.winner ? 0.5 : (d.winner === 'white') === white ? 1 : 0;
  return {
    id: `lichess:${d.id}`,
    site: 'lichess',
    user: u,
    color,
    score,
    playedAt: d.lastMoveAt ?? d.createdAt,
    speed: d.speed,
    rated: d.rated,
    userRating: me.rating,
    oppRating: opp.rating,
    opponent: opp.user?.name ?? (opp.aiLevel ? `Stockfish level ${opp.aiLevel}` : 'Anonymous'),
    moves: d.moves.split(' '),
    url: `https://lichess.org/${d.id}${white ? '' : '/black'}`,
  };
}

/**
 * Streams the user's most recent games (newest first) as NDJSON.
 * `since` (ms) makes it incremental. Anonymous requests stream ~20 games/s.
 */
export async function* lichessGames(
  username: string,
  opts: { max: number; since?: number } & PoliteOptions,
): AsyncGenerator<Game> {
  const q = new URLSearchParams({
    max: String(opts.max),
    moves: 'true',
    tags: 'false',
    finished: 'true',
    perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence', // no variants
  });
  if (opts.since) q.set('since', String(opts.since));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${q}`;
  const res = await politeFetch(url, { ...opts, headers: { Accept: 'application/x-ndjson' } });
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const g = parseLichessGame(JSON.parse(line) as LichessGame, username);
      if (g) yield g;
    }
    if (done) break;
  }
  if (buf.trim()) {
    const g = parseLichessGame(JSON.parse(buf) as LichessGame, username);
    if (g) yield g;
  }
}
