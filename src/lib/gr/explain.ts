// Short, human-readable explanations for classified moves (from explain.py; the tactic-motif
// detector is not ported yet, so explanations rely on material and evaluation).
import { Chess } from 'chess.js';
import type { Color } from '../types';
import type { MoveClass } from './classify';
import { materialBalance } from './material';
import { cpFor, winPctFor, type Eval } from './winprob';

const LABELS: Record<MoveClass, string> = {
  brilliant: 'brilliant', great: 'a great move', best: 'best', excellent: 'excellent', good: 'good', book: 'a book move',
  inaccuracy: 'an inaccuracy', mistake: 'a mistake', miss: 'a miss', blunder: 'a blunder',
};
const PV_HORIZON = 8;

export function materialWords(n: number): string {
  if (n >= 8) return 'the queen';
  if (n >= 5) return 'a rook';
  if (n >= 3) return 'a piece';
  if (n === 2) return 'two pawns';
  return 'a pawn';
}

const play = (c: Chess, uci: string) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

export function pvToSan(fen: string, pv: string[], limit = pv.length): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, limit)) {
    try {
      out.push(play(c, u).san);
    } catch {
      break;
    }
  }
  return out;
}

function materialAfterPv(fen: string, pv: string[], color: Color, horizon = PV_HORIZON): number {
  const c = new Chess(fen);
  for (const u of pv.slice(0, horizon)) {
    try {
      play(c, u);
    } catch {
      break;
    }
  }
  return materialBalance(c, color);
}

const mateFor = (ev: Eval, color: Color) => (ev.mate === null || ev.mate === 0 ? null : color === 'w' ? ev.mate : -ev.mate);

export interface ExplainInput {
  fenBefore: string;
  uci: string;
  classification: MoveClass;
  reasons: string[];
  best: { move: string; pv: string[]; eval: Eval } | null;
  replyPv: string[]; // engine line after the played move
  evalAfter: Eval;
}

export function explain(x: ExplainInput): { headline: string; detail: string } {
  const board = new Chess(x.fenBefore);
  const mover = board.turn();
  const san = new Chess(x.fenBefore).move({ from: x.uci.slice(0, 2), to: x.uci.slice(2, 4), promotion: x.uci[4] }).san;
  const headline = `${san} is ${LABELS[x.classification]}`;
  const beforeBalance = materialBalance(board, mover);
  const afterBoard = new Chess(x.fenBefore);
  play(afterBoard, x.uci);
  const afterFen = afterBoard.fen();
  const bestSan = x.best ? pvToSan(x.fenBefore, [x.best.move])[0] ?? null : null;
  const bestGain = x.best ? materialAfterPv(x.fenBefore, x.best.pv, mover) - beforeBalance : 0;
  const bestMate = x.best ? mateFor(x.best.eval, mover) : null;
  const mateAgainst = mateFor(x.evalAfter, mover);
  const replySan = pvToSan(afterFen, x.replyPv, 1);
  const lossAfter = materialAfterPv(afterFen, x.replyPv, mover) - beforeBalance;
  let detail = '';

  switch (x.classification) {
    case 'brilliant': {
      const piece = x.reasons.find((r) => r.startsWith('sacrifice:'))?.split(':')[1] ?? 'material';
      detail = `A strong sacrifice: it gives up ${piece !== 'material' ? `a ${piece}` : 'material'}, but taking it doesn't work out for the opponent.`;
      break;
    }
    case 'great':
      detail = x.reasons.includes('only-move') ? 'The only good move: every alternative is much worse.' : 'A critical find that turns the game around.';
      break;
    case 'book':
      detail = 'A known opening move.';
      break;
    case 'best':
      detail = afterBoard.isCheckmate() ? 'Checkmate!' : bestMate && bestMate > 1 ? `The strongest move, leading to mate in ${bestMate}.` : 'The engine’s top choice.';
      break;
    case 'excellent':
    case 'good':
      detail = x.reasons.includes('decided') ? 'The game was already decided here, so small differences don’t matter.' : bestSan ? `A solid move. ${bestSan} was slightly better.` : 'A solid move.';
      break;
    default: {
      const parts: string[] = [];
      const winBest = x.best ? winPctFor(x.best.eval, mover) : 50;
      const winAfter = winPctFor(x.evalAfter, mover);
      const swingCp = (x.best ? cpFor(x.best.eval, mover) : 0) - cpFor(x.evalAfter, mover);
      if (x.classification === 'miss') {
        /* the "missed" sentence plus the better move says it all */
      } else if (mateAgainst !== null && mateAgainst < 0) parts.push(`This allows mate in ${-mateAgainst}${replySan[0] ? `, starting with ${replySan[0]}` : ''}.`);
      else if (lossAfter <= -1 && -lossAfter * 100 >= 0.6 * swingCp) parts.push(`This loses ${materialWords(-lossAfter)}${replySan[0] ? ` after ${replySan[0]}.` : '.'}`);
      else if (winBest < 30) parts.push('The position was already difficult, and this makes it worse.');
      else if (winAfter < 20) parts.push('This hands the opponent a winning position.');
      else if (winAfter < 40) parts.push('The opponent is now clearly better.');
      else if (winBest >= 60 && winAfter < 60) parts.push('This throws away the advantage.');
      else if (winBest >= 80) parts.push('This lets a big advantage slip.');
      else parts.push('This makes the position worse.');
      if (bestSan) {
        if (bestMate && bestMate > 0) parts.push(`${bestSan} would have led to mate in ${bestMate}.`);
        else if (bestGain >= 1) parts.push(`${bestSan} would have won ${materialWords(bestGain)}.`);
        else parts.push(`Better was ${bestSan}.`);
      }
      if (x.classification === 'miss') parts.unshift('Missed the chance to punish the opponent’s error.');
      detail = parts.join(' ');
    }
  }
  return { headline, detail };
}
