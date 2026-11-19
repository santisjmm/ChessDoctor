// One-sentence explanations for drill feedback, from engine lines.
import { Chess, type PieceSymbol } from 'chess.js';
import type { Color } from './types';

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME: Record<PieceSymbol, string> = { p: 'a pawn', n: 'your knight', b: 'your bishop', r: 'your rook', q: 'your queen', k: 'your king' };

/** "+0.8" style eval from the user's point of view, in words. */
export function evalWords(cpWhite: number, color: Color): string {
  const cp = color === 'w' ? cpWhite : -cpWhite;
  if (Math.abs(cp) >= 9000) return cp > 0 ? 'winning for you' : 'lost';
  const p = (Math.abs(cp) / 100).toFixed(1);
  if (Math.abs(cp) < 40) return 'about equal';
  return cp > 0 ? `better for you (+${p})` : `worse for you (−${p})`;
}

const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;

export interface ReasonInput {
  fenBefore: string;
  ply: number;
  color: Color; // the user's colour (who plays at `ply`)
  played: string; // SAN
  best: string; // SAN
  cpBest: number; // White POV, after best
  cpPlayed: number; // White POV, after played
  mateAfterPlayed: number | null; // White POV mate distance after the played move
  replyPv: string[]; // SAN, the opponent's best line after the played move
}

/** Material the user loses (in pawns) over a SAN line from `fen`, counting only captures. */
function materialSwing(fen: string, sans: string[], color: Color): { lost: number; first: { san: string; ply: number; piece: PieceSymbol } | null } {
  const c = new Chess(fen);
  let lost = 0;
  let first: { san: string; ply: number; piece: PieceSymbol } | null = null;
  sans.forEach((san, i) => {
    try {
      const mv = c.move(san);
      if (mv.captured) {
        const v = VALUE[mv.captured];
        if (mv.color === color) lost -= v;
        else {
          lost += v;
          if (!first && v >= 3) first = { san: mv.san, ply: i, piece: mv.captured };
        }
      }
    } catch {
      /* stop at an illegal move */
    }
  });
  return { lost, first };
}

export function reasonFor(r: ReasonInput): string {
  const them = r.color === 'w' ? 'Black' : 'White';
  const mine = (cp: number) => (r.color === 'w' ? cp : -cp);
  if (r.mateAfterPlayed !== null && Math.sign(r.mateAfterPlayed) !== (r.color === 'w' ? 1 : -1)) {
    return `${label(r.ply, r.played)} allows a forced mate; ${label(r.ply, r.best)} is safe.`;
  }
  const after = new Chess(r.fenBefore);
  after.move(r.played);
  const swing = materialSwing(after.fen(), r.replyPv.slice(0, 5), r.color);
  if (swing.lost >= 2 && swing.first) {
    return `After ${label(r.ply, r.played)}, ${them} plays ${label(r.ply + 1 + swing.first.ply, swing.first.san)} and wins ${NAME[swing.first.piece]}. ${label(r.ply, r.best)} avoids it.`;
  }
  if (mine(r.cpBest) - mine(r.cpPlayed) >= 30) {
    return `${label(r.ply, r.best)} keeps it ${evalWords(r.cpBest, r.color)}; after ${label(r.ply, r.played)} it is ${evalWords(r.cpPlayed, r.color)}.`;
  }
  return `${label(r.ply, r.best)} is the engine's choice here; ${label(r.ply, r.played)} gives a little away.`;
}
