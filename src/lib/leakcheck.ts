import { Chess } from 'chess.js';
import { db } from './db';
import { winPct, type Engine, type EngineResult, type SearchLimits } from './engine';
import { plyColor } from './openings';

export interface MoveVerdict {
  ply: number;
  fenBefore: string;
  played: string; // SAN
  playedUci: string;
  best: string; // SAN
  bestUci: string;
  bestPv: string[]; // SAN, starting with best
  cpBefore: number; // White POV
  cpAfter: number;
  mateAfter: number | null; // White POV, after the played move
  replyPv: string[]; // SAN, opponent's best line after the played move
  /** Win% the user gave away with the played move. */
  drop: number;
}

// Win% lost that counts as getting the line wrong. Lichess calls 5% an inaccuracy, 10% a mistake.
export const LEAK_DROP = 5;
export const PHONE_LIMITS: SearchLimits = { depth: 12, movetime: 700 };

function uciToSan(fen: string, uci: string): string {
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

export function pvToSan(fen: string, pv: string[], max = 6): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      out.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** Judges the move at `ply` of `line` (SAN from the start). Evaluations are cached on the device. */
export async function judgeMove(engine: Engine, line: string[], ply: number, limits: SearchLimits = PHONE_LIMITS): Promise<MoveVerdict> {
  const chess = new Chess();
  for (const san of line.slice(0, ply)) chess.move(san);
  const fenBefore = chess.fen();
  const before = await cachedEval(engine, fenBefore, limits);
  const mv = chess.move(line[ply]);
  const playedUci = mv.from + mv.to + (mv.promotion ?? '');
  const same = playedUci === before.bestmove;
  const after = same ? before : await cachedEval(engine, chess.fen(), limits);
  const sign = plyColor(ply) === 'w' ? 1 : -1;
  return {
    ply,
    fenBefore,
    played: mv.san,
    playedUci,
    best: uciToSan(fenBefore, before.bestmove),
    bestUci: before.bestmove,
    bestPv: pvToSan(fenBefore, before.pv),
    cpBefore: before.cp,
    cpAfter: after.cp,
    mateAfter: same ? before.mate : after.mate,
    replyPv: same ? pvToSan(chess.fen(), before.pv.slice(1)) : pvToSan(chess.fen(), after.pv),
    drop: same ? 0 : Math.max(0, sign * (winPct(before.cp) - winPct(after.cp))),
  };
}

export async function cachedEval(engine: Engine, fen: string, limits: SearchLimits): Promise<EngineResult> {
  const key = `${fen.split(' ').slice(0, 4).join(' ')}|${limits.depth}`;
  try {
    const hit = await db.evals.get(key);
    if (hit) return hit.result;
  } catch {
    /* storage unavailable: just search */
  }
  const result = await engine.analyse(fen, limits);
  db.evals.put({ key, result }).catch(() => undefined);
  return result;
}
