import Dexie, { type EntityTable } from 'dexie';
import type { EngineResult } from './engine';
import type { Game, Site } from './types';

export interface Profile {
  key: string; // `${site}:${user}`
  site: Site;
  user: string;
  lastImportAt: number;
  newestPlayedAt: number;
}

/** A line to drill, scheduled with spaced repetition (see srs.ts). */
export interface DrillItem {
  id: string; // `${color}|${line.join(' ')}`
  kind: 'mistake' | 'line';
  color: 'w' | 'b';
  family: string;
  opening?: string; // full opening name at the end of book
  line: string[]; // SAN from the start through the final user move to play
  /** Ply of the move this drill is about (the corrected mistake); -1 for a plain line. */
  focusPly: number;
  played?: string; // the user's usual (wrong) move at focusPly
  reason?: string; // one sentence on why the right move is better
  games: number; // how many of the user's games reached it
  createdAt: number;
  box: number; // Leitner box 0..5
  due: number; // ms epoch
  reps: number;
  lapses: number;
  lastAt?: number;
}

export interface Attempt {
  id?: number;
  itemId: string;
  at: number;
  success: boolean;
  misses: number;
}

/** Cached per-game opening analysis (book replay), so the app opens without recomputing. */
export interface CachedOpening {
  id: string; // game id
  v: number; // analysis version
  eco?: string;
  name?: string;
  family?: string;
  exitPly: number;
  exitBy: 'me' | 'opp' | null;
  sans: string[];
}

export const db = new Dexie('opening-trainer') as Dexie & {
  games: EntityTable<Game, 'id'>;
  profiles: EntityTable<Profile, 'key'>;
  evals: EntityTable<{ key: string; result: EngineResult }, 'key'>;
  drills: EntityTable<DrillItem, 'id'>;
  attempts: EntityTable<Attempt, 'id'>;
  openings: EntityTable<CachedOpening, 'id'>;
};

db.version(1).stores({
  games: 'id, [site+user+playedAt]',
  profiles: 'key',
  lines: '++id, createdAt',
});
db.version(2).stores({ evals: 'key' }); // `${fen key}|${depth}`
db.version(3).stores({
  lines: null, // M1 prototype, replaced by drills
  drills: 'id, due, kind',
  attempts: '++id, itemId, at',
  openings: 'id',
});

export async function latestGames(site: Site, user: string, n: number): Promise<Game[]> {
  return db.games
    .where('[site+user+playedAt]')
    .between([site, user, Dexie.minKey], [site, user, Dexie.maxKey])
    .reverse()
    .limit(n)
    .toArray();
}
