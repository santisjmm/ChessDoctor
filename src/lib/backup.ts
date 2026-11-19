// Export / import of everything ChessDoctor keeps on the device, as one JSON file.
// Engine caches (evals, opening analysis) are left out: they are rebuilt as needed.
import { db } from './db';
import { savedAccounts, saveAccounts } from './library';

const TABLES = ['games', 'profiles', 'drills', 'attempts', 'reviews', 'fullReviews', 'bookProgress'] as const;
type TableName = (typeof TABLES)[number];

export interface Backup {
  app: 'chessdoctor';
  version: 1;
  exportedAt: number;
  accounts: ReturnType<typeof savedAccounts>;
  tables: Record<TableName, unknown[]>;
}

export async function exportData(): Promise<Blob> {
  const tables = {} as Record<TableName, unknown[]>;
  for (const t of TABLES) tables[t] = await db.table(t).toArray();
  const b: Backup = { app: 'chessdoctor', version: 1, exportedAt: Date.now(), accounts: savedAccounts(), tables };
  return new Blob([JSON.stringify(b)], { type: 'application/json' });
}

export async function importData(text: string): Promise<{ games: number; drills: number }> {
  const b = JSON.parse(text) as Backup;
  if (b.app !== 'chessdoctor' || b.version !== 1 || !b.tables) throw new Error('This is not a ChessDoctor backup file.');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) if (Array.isArray(b.tables[t])) await db.table(t).bulkPut(b.tables[t]);
  });
  const merged = [...savedAccounts()];
  for (const a of b.accounts ?? []) if (!merged.some((m) => m.site === a.site && m.user.toLowerCase() === a.user.toLowerCase())) merged.push(a);
  saveAccounts(merged);
  return { games: b.tables.games?.length ?? 0, drills: b.tables.drills?.length ?? 0 };
}

export async function deleteAllData() {
  await db.delete();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
}
