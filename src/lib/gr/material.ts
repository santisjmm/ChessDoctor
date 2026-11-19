// Material, static exchange evaluation (SEE) and sacrifice detection (from material.py).
import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { Color } from '../types';

export const PIECE_VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAMES: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SACRIFICE_MIN_NET_LOSS = 2;
const SACRIFICE_MIN_PIECE_VALUE = 3;

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function material(chess: Chess, color: Color): number {
  let n = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.color === color) n += PIECE_VALUES[sq.type];
  return n;
}
export const materialBalance = (chess: Chess, color: Color) => material(chess, color) - material(chess, other(color));

const attackerValue = (m: Move) => (m.piece === 'k' ? 100 : PIECE_VALUES[m.piece]);

/** Material the side to move wins by capturing on `square` (>= 0). Uses legal moves, so pins count. */
export function see(chess: Chess, square: Square): number {
  const target = chess.get(square);
  if (!target || target.color === chess.turn()) return 0;
  const captures = chess.moves({ verbose: true }).filter((m) => m.to === square);
  if (!captures.length) return 0;
  const move = captures.reduce((a, b) => (attackerValue(b) < attackerValue(a) ? b : a));
  let gain = PIECE_VALUES[target.type];
  if (move.promotion) gain += PIECE_VALUES[move.promotion] - 1;
  chess.move(move);
  try {
    gain -= see(chess, square);
  } finally {
    chess.undo();
  }
  return Math.max(0, gain);
}

/** Material gained immediately by a move (capture + promotion). */
export function capturedValue(move: Move): number {
  let v = 0;
  if (move.isEnPassant()) v = 1;
  else if (move.captured) v = PIECE_VALUES[move.captured];
  if (move.promotion) v += PIECE_VALUES[move.promotion] - 1;
  return v;
}

/** Biggest SEE loss for `color` when it's the opponent's turn. */
export function mostValuableHanging(chess: Chess, color: Color): { square: Square; piece: PieceSymbol; loss: number } | null {
  let best: { square: Square; piece: PieceSymbol; loss: number } | null = null;
  for (const row of chess.board())
    for (const sq of row) {
      if (!sq || sq.color !== color || sq.type === 'k') continue;
      const loss = see(chess, sq.square);
      if (loss > 0 && (!best || loss > best.loss)) best = { square: sq.square, piece: sq.type, loss };
    }
  return best;
}

export interface SacrificeInfo {
  isSacrifice: boolean;
  net: number;
  piece?: PieceSymbol;
  square?: Square;
}

/** The position before the move with the opponent on move, for "what was already hanging" (null if illegal). */
function flippedBefore(fenBefore: string, color: Color): Chess | null {
  const parts = fenBefore.split(' ');
  parts[1] = color === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try {
    return new Chess(parts.join(' '));
  } catch {
    return null; // e.g. the mover is in check
  }
}

/**
 * Does the move give up at least a minor piece net (>= 2 pawns after SEE on every piece)?
 * Departure from the Review app: only material the move puts *newly* en prise counts. For every
 * piece, the SEE loss after the move is compared with the loss on that square before it (the
 * moved piece always counts as new), so a piece left hanging for several moves doesn't make each
 * of them a sacrifice.
 */
export function detectSacrifice(fenBefore: string, uci: string): SacrificeInfo {
  const chess = new Chess(fenBefore);
  const mover = chess.turn();
  const before = new Chess(fenBefore).inCheck() ? null : flippedBefore(fenBefore, mover);
  const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const gained = capturedValue(move);
  if (chess.isCheckmate()) return { isSacrifice: false, net: gained };
  let worst: { square: Square; piece: PieceSymbol; loss: number } | null = null;
  for (const row of chess.board())
    for (const sq of row) {
      if (!sq || sq.color !== mover || sq.type === 'k') continue;
      const loss = see(chess, sq.square);
      if (loss <= 0) continue;
      const was = sq.square === move.to || !before ? 0 : see(before, sq.square);
      if (loss > was && (!worst || loss > worst.loss)) worst = { square: sq.square, piece: sq.type, loss };
    }
  if (!worst) return { isSacrifice: false, net: gained };
  const net = gained - worst.loss;
  return {
    isSacrifice: net <= -SACRIFICE_MIN_NET_LOSS && PIECE_VALUES[worst.piece] >= SACRIFICE_MIN_PIECE_VALUE,
    net, piece: worst.piece, square: worst.square,
  };
}
