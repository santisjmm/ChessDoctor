// Learn an opening from the book (lichess-org/chess-openings, CC0): the computer plays book
// replies, favouring lines you haven't learned; you must stay in book until the line ends.
import { familyOf, loadBook } from './book';
import { db } from './db';
import type { Color } from './types';

export interface BookLine {
  index: number;
  eco: string;
  name: string;
  family: string;
  sans: string[];
}

let linesP: Promise<BookLine[]> | null = null;
export function loadBookLines(): Promise<BookLine[]> {
  linesP ??= Promise.all([loadBook(), fetch(`${import.meta.env.BASE_URL}book-lines.json`).then((r) => r.json() as Promise<{ lines: [number, string][] }>)]).then(
    ([book, data]) =>
      data.lines.map(([i, s]) => {
        const [eco, name] = book.names[i];
        return { index: i, eco, name, family: familyOf(name), sans: s.split(' ') };
      }),
  );
  return linesP;
}

const userMoves = (l: BookLine, color: Color) => l.sans.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === color).length;

/** Lines worth drilling with this colour: at least 4 plies and 2 moves of your own. */
export const drillable = (lines: BookLine[], color: Color) => lines.filter((l) => l.sans.length >= 4 && userMoves(l, color) >= 2);

export interface FamilyInfo {
  family: string;
  lines: BookLine[];
}

export function families(lines: BookLine[], color: Color): FamilyInfo[] {
  const m = new Map<string, BookLine[]>();
  for (const l of drillable(lines, color)) m.set(l.family, [...(m.get(l.family) ?? []), l]);
  return [...m].map(([family, ls]) => ({ family, lines: ls })).sort((a, b) => a.family.localeCompare(b.family));
}

const startsWith = (sans: string[], prefix: string[]) => prefix.every((s, i) => sans[i] === s);

/** A line to drill: unlearned lines first (random among them), else any. */
export function pickTarget(lines: BookLine[], learned: Set<number>, rand = Math.random): BookLine {
  const fresh = lines.filter((l) => !learned.has(l.index));
  const pool = fresh.length ? fresh : lines;
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * Judges the user's move after `prefix`. The target line's move is right; another move is still
 * accepted when it continues a different line of the family (unlearned first), which becomes the
 * new target. Otherwise it is a mistake and the target stays.
 */
export function judgeBookMove(
  family: BookLine[],
  target: BookLine,
  prefix: string[],
  san: string,
  learned: Set<number>,
): { ok: boolean; target: BookLine } {
  if (target.sans[prefix.length] === san) return { ok: true, target };
  const next = [...prefix, san];
  const alts = family.filter((l) => l.sans.length > next.length - 1 && startsWith(l.sans, next));
  if (!alts.length) return { ok: false, target };
  const pick = alts.find((l) => !learned.has(l.index)) ?? alts[0];
  return { ok: true, target: pick };
}

export async function learnedLines(color: Color): Promise<Set<number>> {
  const rows = await db.bookProgress.where('color').equals(color).toArray().catch(() => []);
  return new Set(rows.filter((r) => r.learned).map((r) => r.line));
}

export async function recordLine(color: Color, line: number, clean: boolean) {
  const id = `${color}|${line}`;
  const prev = await db.bookProgress.get(id);
  await db.bookProgress.put({ id, color, line, learned: (prev?.learned ?? false) || clean, tries: (prev?.tries ?? 0) + 1, lastAt: Date.now() });
}
