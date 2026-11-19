import { familyOf, loadBook } from './book';
import { db, latestGames, type CachedOpening } from './db';
import type { Account } from './importer';
import { analyseOpening, type GameOpening } from './openings';
import type { Game } from './types';

const ANALYSIS_VERSION = 1;
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

function fromCache(game: Game, c: CachedOpening): GameOpening {
  return {
    game,
    opening: c.name ? { eco: c.eco!, name: c.name, family: c.family ?? familyOf(c.name) } : null,
    exitPly: c.exitPly,
    exitBy: c.exitBy,
    sans: c.sans,
  };
}

/**
 * The newest `max` games per account from the device, with their opening analysis
 * (computed once per game and cached).
 */
export async function loadItems(
  accounts: Account[],
  max: number,
  onProgress?: (done: number, total: number) => void,
): Promise<GameOpening[]> {
  const games = (await Promise.all(accounts.map((a) => latestGames(a.site, a.user.trim().toLowerCase(), max)))).flat();
  const cached = await db.openings.bulkGet(games.map((g) => g.id));
  const missing = games.filter((_, i) => !cached[i] || cached[i]!.v !== ANALYSIS_VERSION);
  const fresh = new Map<string, GameOpening>();
  if (missing.length) {
    const book = await loadBook();
    const rows: CachedOpening[] = [];
    for (let i = 0; i < missing.length; i++) {
      const o = analyseOpening(missing[i], book);
      fresh.set(missing[i].id, o);
      rows.push({
        id: missing[i].id, v: ANALYSIS_VERSION, eco: o.opening?.eco, name: o.opening?.name, family: o.opening?.family,
        exitPly: o.exitPly, exitBy: o.exitBy, sans: o.sans,
      });
      if (i % 20 === 19) {
        onProgress?.(i + 1, missing.length);
        await yieldToUi();
      }
    }
    await db.openings.bulkPut(rows).catch(() => undefined);
  }
  onProgress?.(missing.length, missing.length);
  return games.map((g, i) => fresh.get(g.id) ?? fromCache(g, cached[i]!));
}

export function savedAccounts(): Account[] {
  try {
    return JSON.parse(localStorage.getItem('accounts') ?? '[]') as Account[];
  } catch {
    return [];
  }
}

export function saveAccounts(accounts: Account[]) {
  try {
    localStorage.setItem('accounts', JSON.stringify(accounts));
  } catch {
    /* private mode: accounts are asked again next time */
  }
}
