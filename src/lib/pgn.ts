// PGN import (pasted or from a file): one or many games, stored like imported online games.
import { Chess } from 'chess.js';
import { pgnMoves } from './chesscom';
import type { Game } from './types';

export interface PgnGame {
  headers: Record<string, string>;
  moves: string[]; // SAN, validated
}

/** Splits a PGN file into games and parses headers and moves (invalid games are dropped). */
export function parsePgn(text: string): { games: PgnGame[]; skipped: number } {
  const chunks = text.replace(/\r/g, '').split(/\n(?=\[Event\s)/).map((c) => c.trim()).filter(Boolean);
  const games: PgnGame[] = [];
  let skipped = 0;
  for (const chunk of chunks) {
    const headers: Record<string, string> = {};
    for (const m of chunk.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2].replace(/\\(.)/g, '$1');
    const variant = (headers.Variant ?? 'Standard').toLowerCase();
    if (headers.SetUp === '1' || headers.FEN || (variant !== 'standard' && variant !== 'chess')) {
      skipped++;
      continue;
    }
    const sans = pgnMoves(chunk);
    const c = new Chess();
    const moves: string[] = [];
    try {
      for (const s of sans) moves.push(c.move(s).san);
    } catch {
      /* keep the valid prefix */
    }
    if (moves.length < 2) {
      skipped++;
      continue;
    }
    games.push({ headers, moves });
  }
  return { games, skipped };
}

/** The player name that appears in the most games (a good default for "your name"). */
export function mostCommonPlayer(games: PgnGame[]): string | null {
  const n = new Map<string, number>();
  for (const g of games) for (const k of ['White', 'Black']) if (g.headers[k] && g.headers[k] !== '?') n.set(g.headers[k], (n.get(g.headers[k]) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const SPEEDS: [number, string][] = [[29, 'ultraBullet'], [179, 'bullet'], [479, 'blitz'], [1499, 'rapid']];
function speedOf(tc: string | undefined): string {
  if (!tc || tc === '-' || tc === '?') return 'unknown';
  if (tc.includes('/')) return 'daily';
  const [base, inc = '0'] = tc.split('+').map(Number);
  if (Number.isNaN(base)) return 'unknown';
  const est = base + 40 * (Number(inc) || 0);
  return SPEEDS.find(([max]) => est <= max)?.[1] ?? 'classical';
}

function playedAt(h: Record<string, string>): number {
  const d = (h.UTCDate ?? h.Date ?? '').replace(/\./g, '-');
  const t = h.UTCTime ?? h.EndTime ?? '12:00:00';
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T${t.slice(0, 8)}Z` : '');
  return Number.isNaN(ms) ? Date.now() : ms;
}

/** Stable id from the headers and moves, so importing the same file twice doesn't duplicate games. */
function hashId(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Converts parsed games to the user's point of view; games without `name` are skipped. */
export function toGames(games: PgnGame[], name: string): { games: Game[]; notMine: number } {
  const me = name.trim().toLowerCase();
  const out: Game[] = [];
  let notMine = 0;
  for (const g of games) {
    const white = (g.headers.White ?? '').toLowerCase() === me;
    const black = (g.headers.Black ?? '').toLowerCase() === me;
    if (white === black) {
      notMine++;
      continue;
    }
    const r = g.headers.Result ?? '*';
    const score = r === '1/2-1/2' ? 0.5 : r === '1-0' ? (white ? 1 : 0) : r === '0-1' ? (white ? 0 : 1) : null;
    if (score === null) {
      notMine++;
      continue;
    }
    const opp = white ? g.headers.Black : g.headers.White;
    const elo = (k: string) => (g.headers[k] && /^\d+$/.test(g.headers[k]) ? Number(g.headers[k]) : undefined);
    const site = g.headers.Site ?? '';
    out.push({
      id: `pgn:${hashId(JSON.stringify([g.headers.White, g.headers.Black, g.headers.Date, g.headers.UTCTime, g.moves.join(' ')]))}`,
      site: 'pgn', user: me, color: white ? 'w' : 'b', score: score as 0 | 0.5 | 1, playedAt: playedAt(g.headers),
      speed: speedOf(g.headers.TimeControl), rated: false,
      userRating: elo(white ? 'WhiteElo' : 'BlackElo'), oppRating: elo(white ? 'BlackElo' : 'WhiteElo'),
      opponent: opp && opp !== '?' ? opp : 'Unknown', moves: g.moves, url: /^https?:\/\//.test(site) ? site : '',
    });
  }
  return { games: out, notMine };
}
