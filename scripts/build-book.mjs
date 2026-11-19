// Builds public/book.json from the lichess-org/chess-openings TSVs (CC0) in data/chess-openings.
// Every position reached along a named line counts as "book". A position's name is the
// name of the line that ends there (if any).
// Output: { names: [[eco, name], ...], pos: { "<fen key>": nameIndex | -1 } }
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { Chess } from 'chess.js';

const dir = new URL('../data/chess-openings/', import.meta.url);
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');

const names = [];
const pos = new Map();
const lines = []; // [nameIndex, 'e4 c5 Nf3'] for the Learn mode
for (const f of readdirSync(dir).filter((f) => f.endsWith('.tsv')).sort()) {
  const rows = readFileSync(new URL(f, dir), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    for (const san of sans) {
      chess.move(san);
      const k = key(chess.fen());
      if (!pos.has(k)) pos.set(k, -1);
    }
    names.push([eco, name]);
    pos.set(key(chess.fen()), names.length - 1);
    lines.push([names.length - 1, chess.history().join(' ')]);
  }
}
const out = { source: 'lichess-org/chess-openings (CC0-1.0)', names, pos: Object.fromEntries(pos) };
writeFileSync(new URL('../public/book.json', import.meta.url), JSON.stringify(out));
writeFileSync(new URL('../public/book-lines.json', import.meta.url), JSON.stringify({ source: out.source, lines }));
console.log(`${names.length} named lines, ${pos.size} book positions`);
