// Move classification, ported from the Review app (backend/review/analysis/classify.py).
// Pure functions: engine lines in, label out. Approximates chess.com's categories; it is not
// chess.com's algorithm.
import { Chess, type Move } from 'chess.js';
import type { Color } from '../types';
import { capturedValue, detectSacrifice, PIECE_NAMES, see } from './material';
import { cpFor, winPctFor, type Eval } from './winprob';

export const CLASSES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'] as const;
export type MoveClass = (typeof CLASSES)[number];
export const KEY_MOMENT_CLASSES = new Set<MoveClass>(['brilliant', 'great', 'miss', 'mistake', 'blunder']);
export const ERROR_CLASSES = new Set<MoveClass>(['inaccuracy', 'mistake', 'miss', 'blunder']);

const EXCELLENT_MAX_DROP = 2, GOOD_MAX_DROP = 5, INACCURACY_MAX_DROP = 10, MISTAKE_MAX_DROP = 20;
const DECIDED_HIGH = 95, DECIDED_LOW = 5, BOOK_MAX_DROP = INACCURACY_MAX_DROP;
const BRILLIANT_MAX_DROP = 2, BRILLIANT_MAX_WIN_BEFORE = 90, BRILLIANT_MIN_WIN_AFTER = 50;
const GREAT_ONLY_MOVE_GAP = 20, GREAT_SWING_GAP = 10;
const GREAT_SWING_FROM_LOSING = 30, GREAT_SWING_TO_EQUAL = 45, GREAT_SWING_FROM_EQUAL = 60, GREAT_SWING_TO_WINNING = 75;
const MISS_OPPONENT_MIN_DROP = INACCURACY_MAX_DROP, MISS_MIN_DROP = INACCURACY_MAX_DROP, MISS_GIVEBACK_RATIO = 0.5, MISS_WORSE_TOLERANCE = 5;
export const CPL_MOVE_CAP = 300;

export interface Line {
  move: string; // UCI
  eval: Eval; // White POV
  pv: string[]; // UCI
}

export interface PlyInput {
  fenBefore: string;
  uci: string; // the move played
  lastMoveTo?: string; // square the previous move went to (recapture check)
  lines: Line[]; // engine lines for the position before the move, best first
  evalAfter: Eval; // engine eval after the played move (White POV)
  inBook?: boolean;
}

export interface PlyResult {
  classification: MoveClass;
  color: Color;
  winBest: number;
  winAfter: number;
  drop: number; // 0 when ignored in decided positions
  rawDrop: number;
  cpl: number;
  isBest: boolean;
  sacrifice: boolean;
  reasons: string[];
}

export function thresholdClass(drop: number): MoveClass {
  if (drop <= EXCELLENT_MAX_DROP) return 'excellent';
  if (drop <= GOOD_MAX_DROP) return 'good';
  if (drop <= INACCURACY_MAX_DROP) return 'inaccuracy';
  if (drop <= MISTAKE_MAX_DROP) return 'mistake';
  return 'blunder';
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function classifyPly(inp: PlyInput, prev?: PlyResult | null): PlyResult {
  if (!inp.lines.length) throw new Error('classification needs at least one engine line');
  const board = new Chess(inp.fenBefore);
  const mover = board.turn();
  const legal = board.moves({ verbose: true });
  const move = legal.find((m) => m.from + m.to + (m.promotion ?? '') === inp.uci) ?? legal.find((m) => m.from + m.to === inp.uci.slice(0, 4));
  if (!move) throw new Error(`illegal move ${inp.uci}`);
  const best = inp.lines[0];
  const winBest = winPctFor(best.eval, mover);
  const played = inp.lines.find((l) => l.move === inp.uci);
  const afterEval = played ? played.eval : inp.evalAfter;
  const winAfter = winPctFor(afterEval, mover);
  const isBest = inp.uci === best.move || (played !== undefined && winPctFor(played.eval, mover) >= winBest - 1e-9);
  const rawDrop = isBest ? 0 : Math.max(0, winBest - winAfter);
  const cpl = isBest ? 0 : Math.min(CPL_MOVE_CAP, Math.max(0, cpFor(best.eval, mover) - cpFor(afterEval, mover)));
  const secondGap = inp.lines.length >= 2 ? winBest - winPctFor(inp.lines[1].eval, mover) : null;
  const res: PlyResult = {
    classification: 'best', color: mover, winBest: round2(winBest), winAfter: round2(winAfter), drop: round2(rawDrop),
    rawDrop: round2(rawDrop), cpl: Math.trunc(cpl), isBest, sacrifice: false, reasons: [],
  };

  // 1. Book
  if (inp.inBook && rawDrop <= BOOK_MAX_DROP) return { ...res, classification: 'book', reasons: ['book'] };

  // 2. Decided positions: don't nitpick
  const decided = (winBest >= DECIDED_HIGH && winAfter >= DECIDED_HIGH) || (winBest <= DECIDED_LOW && winAfter <= DECIDED_LOW);
  if (decided)
    return { ...res, drop: 0, cpl: 0, reasons: ['decided'], classification: isBest ? 'best' : rawDrop <= EXCELLENT_MAX_DROP ? 'excellent' : 'good' };

  // 3. Brilliant: a sound sacrifice when not already totally winning
  if (legal.length > 1 && rawDrop <= BRILLIANT_MAX_DROP && winBest <= BRILLIANT_MAX_WIN_BEFORE && winAfter >= BRILLIANT_MIN_WIN_AFTER) {
    const sac = detectSacrifice(inp.fenBefore, inp.uci);
    if (sac.isSacrifice) return { ...res, sacrifice: true, classification: 'brilliant', reasons: [`sacrifice:${sac.piece ? PIECE_NAMES[sac.piece] : 'material'}`] };
  }

  // 4. Great: only move, or a swing after the opponent's error
  if (isBest && legal.length > 1 && secondGap !== null) {
    const grabs = winsMaterialDirectly(inp.fenBefore, move);
    const recapture = !!inp.lastMoveTo && !!move.captured && move.to === inp.lastMoveTo;
    if (secondGap >= GREAT_ONLY_MOVE_GAP && !recapture && !grabs) return { ...res, classification: 'great', reasons: ['only-move'] };
    if (prev && secondGap >= GREAT_SWING_GAP && !grabs) {
      const before = 100 - prev.winBest;
      if ((before <= GREAT_SWING_FROM_LOSING && winAfter >= GREAT_SWING_TO_EQUAL) || (before <= GREAT_SWING_FROM_EQUAL && winAfter >= GREAT_SWING_TO_WINNING))
        return { ...res, classification: 'great', reasons: ['swing'] };
    }
  }
  if (isBest) return res;

  // 5. Miss: failing to punish the opponent's error
  if (prev && rawDrop > MISS_MIN_DROP) {
    const beforeError = 100 - prev.winBest;
    const gift = winBest - beforeError;
    if (gift > MISS_OPPONENT_MIN_DROP && winAfter < beforeError + (1 - MISS_GIVEBACK_RATIO) * gift && winAfter >= beforeError - MISS_WORSE_TOLERANCE)
      return { ...res, classification: 'miss', reasons: ['missed-punish'] };
  }
  return { ...res, classification: thresholdClass(rawDrop) };
}

/** A capture that simply nets material (e.g. taking a hanging piece). */
function winsMaterialDirectly(fenBefore: string, move: Move): boolean {
  if (!move.captured) return false;
  const gained = capturedValue(move);
  const after = new Chess(fenBefore);
  after.move({ from: move.from, to: move.to, promotion: move.promotion });
  return gained - see(after, move.to) >= 2;
}
