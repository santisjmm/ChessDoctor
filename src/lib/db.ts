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

export interface SavedLine {
  id?: number;
  createdAt: number;
  color: 'w' | 'b';
  family: string;
  line: string[]; // SAN from the start
  /** Ply index of the move to train, and the better move there (SAN). */
  ply: number;
  better?: string;
  source: 'report';
}

export const db = new Dexie('opening-trainer') as Dexie & {
  games: EntityTable<Game, 'id'>;
  profiles: EntityTable<Profile, 'key'>;
  lines: EntityTable<SavedLine, 'id'>;
  evals: EntityTable<{ key: string; result: EngineResult }, 'key'>;
};

db.version(1).stores({
  games: 'id, [site+user+playedAt]',
  profiles: 'key',
  lines: '++id, createdAt',
});
db.version(2).stores({ evals: 'key' }); // `${fen key}|${depth}`

export async function latestGames(site: Site, user: string, n: number): Promise<Game[]> {
  return db.games
    .where('[site+user+playedAt]')
    .between([site, user, Dexie.minKey], [site, user, Dexie.maxKey])
    .reverse()
    .limit(n)
    .toArray();
}
