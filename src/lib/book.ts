export interface BookData {
  names: [string, string][];
  pos: Record<string, number>;
}

export interface OpeningName {
  eco: string;
  name: string;
  family: string;
}

// Catch-all families whose real identity is the "system" named inside them,
// e.g. "Queen's Pawn Game: Accelerated London System" -> "London System".
const GENERIC = new Set([
  "Queen's Pawn Game", 'Indian Defense', "King's Pawn Game", 'Zukertort Opening', 'Horwitz Defense',
  'Englund Gambit Complex', "Van't Kruijs Opening", 'Hungarian Opening',
]);
const SYSTEMS: [RegExp, string][] = [
  [/Jobava London/, 'Jobava London System'],
  [/London System/, 'London System'],
  [/Colle System/, 'Colle System'],
  [/Torre Attack/, 'Torre Attack'],
  [/Stonewall Attack/, 'Stonewall Attack'],
  [/Barry Attack/, 'Barry Attack'],
];

/** The opening "family" used for grouping and display. */
export function familyOf(name: string): string {
  const [head, rest = ''] = name.split(/:(.*)/s).map((x) => x.trim());
  for (const [re, sys] of SYSTEMS) if (re.test(head)) return sys;
  if (GENERIC.has(head)) for (const [re, sys] of SYSTEMS) if (re.test(rest)) return sys;
  return head.split(',')[0].trim();
}

export const fenKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** Opening book from lichess-org/chess-openings (CC0). */
export class Book {
  constructor(private data: BookData) {}

  has(key: string): boolean {
    return key in this.data.pos;
  }

  /** Every named line's [eco, name], by index (as in book-lines.json). */
  get names(): [string, string][] {
    return this.data.names;
  }

  name(key: string): OpeningName | null {
    const i = this.data.pos[key];
    if (i === undefined || i < 0) return null;
    const [eco, name] = this.data.names[i];
    return { eco, name, family: familyOf(name) };
  }
}

let cached: Promise<Book> | null = null;
export function loadBook(): Promise<Book> {
  cached ??= fetch(`${import.meta.env.BASE_URL}book.json`)
    .then((r) => r.json() as Promise<BookData>)
    .then((d) => new Book(d));
  return cached;
}
