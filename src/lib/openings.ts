import { Chess } from 'chess.js';
import { Book, fenKey, type OpeningName } from './book';
import type { Color, Game } from './types';

/** Plies looked at for the opening phase (15 moves each). */
export const OPENING_PLIES = 30;

export interface GameOpening {
  game: Game;
  opening: OpeningName | null; // deepest named position reached
  /** Index of the first ply that is out of book (= number of book plies). OPENING_PLIES if never left. */
  exitPly: number;
  /** Who played the first non-book move. */
  exitBy: 'me' | 'opp' | null;
  sans: string[]; // first OPENING_PLIES moves (validated)
}

export const moveNumber = (ply: number) => Math.floor(ply / 2) + 1;
export const plyColor = (ply: number): Color => (ply % 2 === 0 ? 'w' : 'b');

/** Replays the opening phase of a game against the book. */
export function analyseOpening(game: Game, book: Book): GameOpening {
  const chess = new Chess();
  let opening: OpeningName | null = null;
  let exitPly = -1;
  const sans: string[] = [];
  for (let ply = 0; ply < Math.min(OPENING_PLIES, game.moves.length); ply++) {
    try {
      sans.push(chess.move(game.moves[ply]).san);
    } catch {
      break; // malformed move: stop here
    }
    const key = fenKey(chess.fen());
    if (exitPly < 0) {
      if (book.has(key)) opening = book.name(key) ?? opening;
      else exitPly = ply;
    }
  }
  const exitBy = exitPly < 0 ? null : plyColor(exitPly) === game.color ? 'me' : 'opp';
  return { game, opening, exitPly: exitPly < 0 ? Math.max(sans.length, OPENING_PLIES) : exitPly, exitBy, sans };
}
