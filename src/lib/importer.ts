import { chesscomGames } from './chesscom';
import { db, latestGames } from './db';
import { lichessGames } from './lichess';
import { HttpError } from './polite';
import type { Game, ImportProgress, Site } from './types';

export interface Account {
  site: Site;
  user: string;
}

/**
 * Imports the newest `max` games for each account (incremental: only games newer than the
 * last import are fetched), stores them on the device and returns the newest `max` per account.
 */
export async function importAccounts(
  accounts: Account[],
  max: number,
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal,
): Promise<Game[]> {
  const all: Game[] = [];
  // Different hosts: run both sites at the same time (each site stays one request at a time).
  await Promise.all(
    accounts.map(async ({ site, user }) => {
      const u = user.trim().toLowerCase();
      const key = `${site}:${u}`;
      const profile = await db.profiles.get(key);
      const have = await db.games.where('[site+user+playedAt]').between([site, u, 0], [site, u, Infinity]).count();
      // Re-fetch fully if we hold fewer than asked for; otherwise only what's new.
      const since = profile && have >= max ? profile.newestPlayedAt + 1 : undefined;
      const gen = site === 'lichess' ? lichessGames : chesscomGames;
      let fetched = 0;
      let newest = profile?.newestPlayedAt ?? 0;
      let batch: Game[] = [];
      const flush = async () => {
        if (batch.length) await db.games.bulkPut(batch);
        batch = [];
      };
      onProgress({ site, fetched, target: max });
      try {
        for await (const g of gen(u, {
          max,
          since,
          signal,
          onWait: (s) => onProgress({ site, fetched, target: max, note: `Rate limited, waiting ${s}s…` }),
        })) {
          fetched++;
          newest = Math.max(newest, g.playedAt);
          batch.push(g);
          if (batch.length >= 50) await flush();
          onProgress({ site, fetched, target: since ? fetched : max });
        }
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) throw new Error(`No ${siteName(site)} player called "${user}".`);
        throw e;
      }
      await flush();
      await db.profiles.put({ key, site, user: u, lastImportAt: Date.now(), newestPlayedAt: newest });
      const games = await latestGames(site, u, max);
      onProgress({ site, fetched: games.length, target: games.length, note: 'done' });
      all.push(...games);
    }),
  );
  return all;
}

export const siteName = (s: Site) => (s === 'lichess' ? 'Lichess' : 'Chess.com');
