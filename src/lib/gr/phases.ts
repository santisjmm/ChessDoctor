// Opening / middlegame / endgame split (from the Review app's phases.py, simplified lichess Divider).
import { Chess } from 'chess.js';

const MIDDLEGAME_MAX_PIECES = 10, ENDGAME_MAX_PIECES = 6, OPENING_MAX_PLY = 30;
export type Phase = 'opening' | 'middlegame' | 'endgame';

function counts(c: Chess) {
  let pieces = 0, w1 = 0, b8 = 0;
  for (const row of c.board())
    for (const s of row) {
      if (!s) continue;
      if (s.type !== 'p' && s.type !== 'k') pieces++;
      if (s.color === 'w' && s.square[1] === '1') w1++;
      if (s.color === 'b' && s.square[1] === '8') b8++;
    }
  return { pieces, sparse: w1 < 4 || b8 < 4 };
}

/** Phase of the position before each ply (phases only move forward). */
export function phasesForGame(fens: string[], bookPlies: number): Phase[] {
  const out: Phase[] = [];
  let mid = false, end = false;
  for (let i = 0; i < fens.length - 1; i++) {
    const { pieces, sparse } = counts(new Chess(fens[i]));
    if (pieces <= ENDGAME_MAX_PIECES) end = true;
    else if (i >= bookPlies && (pieces <= MIDDLEGAME_MAX_PIECES || sparse || i >= OPENING_MAX_PLY)) mid = true;
    out.push(end ? 'endgame' : mid ? 'middlegame' : 'opening');
  }
  return out;
}
