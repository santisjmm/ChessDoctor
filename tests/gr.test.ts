// Ported from the Review app's tests (test_classify.py, test_winprob_accuracy.py, test_game_rating.py).
import { Chess, type Square } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { gameAccuracy, moveAccuracy, sideStats, VOL_MAX, VOL_MIN, volatilityWeights } from '../src/lib/gr/accuracy';
import { classifyPly, thresholdClass, type PlyResult } from '../src/lib/gr/classify';
import { detectSacrifice, see } from '../src/lib/gr/material';
import { estimateRating, MIN_MOVES } from '../src/lib/gr/rating';
import { cpEval, mateEval, whiteWinPct, winPctCp, type Eval } from '../src/lib/gr/winprob';

const cp = cpEval, mate = (n: number) => mateEval(n);
const GREEK_GIFT = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R2QK2R w KQ - 0 8';
const after = (sans: string[], fen?: string) => {
  const c = fen ? new Chess(fen) : new Chess();
  for (const s of sans) c.move(s);
  return c;
};
const uci = (c: Chess, san: string) => {
  const m = new Chess(c.fen()).move(san);
  return m.from + m.to + (m.promotion ?? '');
};
function mk(board: Chess, san: string, lines: [string, Eval][], evalAfter?: Eval, inBook = false) {
  const played = uci(board, san);
  const parsed = lines.map(([s, ev]) => ({ move: uci(board, s), eval: ev, pv: [uci(board, s)] }));
  const lastMoveTo = board.history({ verbose: true }).at(-1)?.to;
  return {
    fenBefore: board.fen(), uci: played, lastMoveTo, lines: parsed, inBook,
    evalAfter: evalAfter ?? parsed.find((l) => l.move === played)?.eval ?? parsed[0].eval,
  };
}
const prevPly = (classification: PlyResult['classification'], color: 'w' | 'b', winBest: number, winAfter: number, drop: number): PlyResult => ({
  classification, color, winBest, winAfter, drop, rawDrop: drop, cpl: 0, isBest: false, sacrifice: false, reasons: [],
});

describe('win%', () => {
  it('matches the reference values and treats mates as certain', () => {
    expect(winPctCp(0)).toBe(50);
    expect(winPctCp(5000)).toBe(winPctCp(1000));
    expect(whiteWinPct(mate(3))).toBe(100);
    expect(whiteWinPct(mate(-1))).toBe(0);
    expect(whiteWinPct(mateEval(0, 'w'))).toBe(100);
  });
});

describe('classification', () => {
  it.each([[0, 'excellent'], [2, 'excellent'], [2.01, 'good'], [5, 'good'], [7, 'inaccuracy'], [10, 'inaccuracy'], [15, 'mistake'], [20, 'mistake'], [20.5, 'blunder'], [60, 'blunder']] as const)(
    'threshold %s -> %s', (d, c) => expect(thresholdClass(d)).toBe(c));
  it('top and tied moves are best', () => {
    const b = new Chess();
    expect(classifyPly(mk(b, 'e4', [['e4', cp(30)], ['d4', cp(28)], ['Nf3', cp(25)]])).classification).toBe('best');
    expect(classifyPly(mk(b, 'd4', [['e4', cp(30)], ['d4', cp(30)], ['Nf3', cp(25)]])).classification).toBe('best');
  });
  it('blunder with capped CPL; inaccuracy; mistake', () => {
    const b = after(['e4', 'e5', 'Nf3', 'Nc6']);
    const lines: [string, Eval][] = [['Bb5', cp(40)], ['Bc4', cp(35)], ['d4', cp(30)]];
    const r = classifyPly(mk(b, 'Ng5', lines, cp(-350)));
    expect(r.classification).toBe('blunder');
    expect(r.cpl).toBe(300);
    expect(classifyPly(mk(b, 'a3', lines, cp(-60))).classification).toBe('inaccuracy');
    expect(classifyPly(mk(b, 'a3', lines, cp(-120))).classification).toBe('mistake');
  });
  it('book, but not hiding a real mistake', () => {
    expect(classifyPly(mk(new Chess(), 'e4', [['d4', cp(35)], ['e4', cp(30)], ['Nf3', cp(25)]], undefined, true)).classification).toBe('book');
    const b = after(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(classifyPly(mk(b, 'a3', [['Bb5', cp(40)], ['Bc4', cp(35)]], cp(-200), true)).classification).not.toBe('book');
  });
  it('decided positions', () => {
    const won = new Chess('7k/8/5K2/8/8/8/8/1Q6 w - - 0 1');
    const r = classifyPly(mk(won, 'Kg6', [['Qb8+', mate(2)], ['Qh1+', mate(3)], ['Kf7', mate(3)]], cp(1500)));
    expect(['excellent', 'good']).toContain(r.classification);
    expect(r.drop).toBe(0);
    expect(r.reasons).toContain('decided');
    expect(classifyPly(mk(won, 'Kg6', [['Qb8+', mate(2)], ['Qh1+', mate(3)]], cp(0))).classification).toBe('blunder');
  });
  it('detects sacrifices with SEE', () => {
    const b = new Chess(GREEK_GIFT);
    const s = detectSacrifice(b.fen(), uci(b, 'Bxh7+'));
    expect(s).toMatchObject({ isSacrifice: true, piece: 'b', net: -2 });
    const t = after(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(detectSacrifice(t.fen(), uci(t, 'Bxc6')).isSacrifice).toBe(false);
    const kg = after(['e4', 'e5']);
    expect(detectSacrifice(kg.fen(), uci(kg, 'f4')).isSacrifice).toBe(false);
  });
  it('a piece that was already hanging is not a new sacrifice', () => {
    // Queen c5 -> a7 opens the d6 bishop's diagonal to the a3 rook: a real (exchange) sacrifice.
    const a = new Chess('1r4k1/3q1ppp/2bb4/2Qp4/8/RP2PB1P/5PP1/3R2K1 w - - 1 34');
    expect(detectSacrifice(a.fen(), 'c5a7').isSacrifice).toBe(true);
    // Two moves later the rook is still hanging; Qa8 -> a7 doesn't put anything new en prise.
    const b = new Chess('Qr4k1/3q1ppp/2bb4/3p4/8/RP2PB1P/5PP1/3R2K1 w - - 5 36');
    expect(detectSacrifice(b.fen(), 'a8a7').isSacrifice).toBe(false);
    const c = new Chess('6k1/Qr1q1ppp/2bb4/3p4/8/RP2PB1P/5PP1/3R2K1 w - - 7 37');
    expect(detectSacrifice(c.fen(), 'a7a5').isSacrifice).toBe(false);
  });
  it('brilliant greek gift, and when it is not', () => {
    const b = new Chess(GREEK_GIFT);
    expect(classifyPly(mk(b, 'Bxh7+', [['Bxh7+', cp(250)], ['O-O', cp(60)], ['a3', cp(50)]])).classification).toBe('brilliant');
    expect(classifyPly(mk(b, 'Bxh7+', [['Bxh7+', cp(800)], ['O-O', cp(700)]])).classification).not.toBe('brilliant');
    expect(['mistake', 'blunder']).toContain(classifyPly(mk(b, 'Bxh7+', [['O-O', cp(60)], ['a3', cp(50)]], cp(-250))).classification);
    expect(classifyPly(mk(b, 'Bxh7+', [['Bxh7+', cp(-150)], ['O-O', cp(-300)]])).classification).not.toBe('brilliant');
  });
  it('great: only move, not a recapture, not forced, swing, not grabbing a hanging piece', () => {
    const b = after(['e4', 'e5', 'Nf3', 'Nc6']);
    const r = classifyPly(mk(b, 'd4', [['d4', cp(50)], ['Bc4', cp(-250)], ['Bb5', cp(-300)]]));
    expect(r.classification).toBe('great');
    expect(r.reasons).toContain('only-move');
    const rc = after(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'Bg4', 'Be2', 'Bxf3']);
    expect(classifyPly(mk(rc, 'Bxf3', [['Bxf3', cp(40)], ['gxf3', cp(-200)]])).classification).toBe('best');
    const forced = new Chess('k7/2Q5/8/8/7p/8/8/K7 b - - 0 1');
    expect(classifyPly(mk(forced, 'h3', [['h3', cp(-300)]])).classification).toBe('best');
    const sw = classifyPly(mk(b, 'd4', [['d4', cp(300)], ['Bc4', cp(120)], ['Bb5', cp(100)]]), prevPly('mistake', 'b', 60, 25, 35));
    expect(sw.classification).toBe('great');
    expect(sw.reasons).toContain('swing');
    const hung = new Chess('rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3');
    expect(classifyPly(mk(hung, 'Nxd5', [['Nxd5', cp(500)], ['Qf3', cp(100)]]), prevPly('blunder', 'b', 50, 5, 45)).classification).toBe('best');
  });
  it('miss after an opponent blunder, but not a small slip or without an error', () => {
    const hung = new Chess('rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3');
    const prev = prevPly('blunder', 'b', 50, 5, 45);
    expect(classifyPly(mk(hung, 'a3', [['Nxd5', cp(900)], ['Qf3', cp(100)]], cp(-50)), prev).classification).toBe('miss');
    expect(classifyPly(mk(hung, 'Qf3', [['Nxd5', cp(900)], ['Qf3', cp(700)]]), prev).classification).not.toBe('miss');
    const b = after(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(classifyPly(mk(b, 'a3', [['Bb5', cp(40)], ['Bc4', cp(35)]], cp(-250)), { ...prevPly('best', 'b', 50, 50, 0), isBest: true }).classification).toBe('blunder');
  });
  it('SEE respects defenders and pins', () => {
    expect(see(new Chess('rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3'), 'd5' as Square)).toBe(9);
    expect(see(new Chess('4k3/8/2p5/3p4/8/8/3Q4/4K3 w - - 0 1'), 'd5' as Square)).toBe(0);
    expect(see(new Chess('3rk3/8/4p3/8/3N4/8/8/3K4 w - - 0 1'), 'e6' as Square)).toBe(0);
  });
});

describe('accuracy', () => {
  it('is bounded, decreasing, and one blunder weighs more than its share', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0);
    const vals = Array.from({ length: 200 }, (_, d) => moveAccuracy(d / 2));
    expect(vals.every((v, i) => i === 0 || vals[i - 1] >= v)).toBe(true);
    const good = Array(29).fill(moveAccuracy(0));
    expect(gameAccuracy([...good, moveAccuracy(60)])).toBeLessThan((good.reduce((a, b) => a + b, 0) + moveAccuracy(60)) / 30);
  });
  it('volatility weights and sharp errors', () => {
    expect(volatilityWeights(Array(21).fill(50))).toEqual(Array(20).fill(VOL_MIN));
    const wild = volatilityWeights([50, 90, 10, 90, 10, 90, 10, 90, 10, 90, 10]);
    expect(Math.max(...wild)).toBe(VOL_MAX);
    const g = moveAccuracy(0), bad = moveAccuracy(40);
    expect(gameAccuracy([g, bad, g], [0.5, 5, 0.5])).toBeLessThan(gameAccuracy([g, bad, g], [5, 0.5, 5]));
  });
  it('side stats', () => {
    const p = (c: PlyResult['classification'], drop: number, cpl: number): PlyResult => ({ ...prevPly(c, 'w', 50, 50 - drop, drop), cpl, isBest: c === 'best' });
    const st = sideStats([p('best', 0, 0), p('blunder', 30, 300), p('good', 4, 40)]);
    expect(st.moves).toBe(3);
    expect(st.counts.blunder).toBe(1);
    expect(st.acpl).toBeCloseTo(113.3, 1);
    expect(sideStats([]).accuracy).toBeNull();
  });
});

describe('game rating', () => {
  const stats = (o: Partial<Parameters<typeof estimateRating>[0]> = {}) => ({ accuracy: 75, acpl: 45, moves: 30, timeClass: 'rapid', blunders: 1, mistakes: 2, misses: 0, ...o });
  it.each([[50, 123, 300], [62, 68, 750], [69, 62, 1000], [80, 36, 1350], [87, 22, 1750]])('acc %s acpl %s lands near %s', (acc, acpl, exp) => {
    expect(Math.abs(estimateRating(stats({ accuracy: acc, acpl, blunders: 0, mistakes: 1 })).rating! - exp)).toBeLessThanOrEqual(250);
  });
  it('is monotonic, needs enough moves, is rounded and has a range', () => {
    expect(estimateRating(stats({ accuracy: 80 })).rating!).toBeGreaterThanOrEqual(estimateRating(stats({ accuracy: 70 })).rating!);
    expect(estimateRating(stats({ timeClass: 'bullet' })).rating!).toBeGreaterThan(estimateRating(stats({ timeClass: 'classical' })).rating!);
    expect(estimateRating(stats({ moves: MIN_MOVES - 1 })).rating).toBeNull();
    const r = estimateRating(stats());
    expect(r.rating! % 10).toBe(0);
    expect(r.low!).toBeLessThan(r.rating!);
    expect(r.high!).toBeGreaterThan(r.rating!);
  });
});

describe('engine output parsing', () => {
  it('collects MultiPV lines, best first, White POV', async () => {
    const { parseSearch } = await import('../src/lib/engine');
    const out = [
      'info depth 10 seldepth 12 multipv 1 score cp 35 nodes 1 pv e7e5 g1f3',
      'info depth 10 seldepth 12 multipv 2 score cp 20 nodes 1 pv c7c5 g1f3',
      'info depth 11 seldepth 13 multipv 2 score cp 18 nodes 1 pv c7c5 g1f3 d7d6',
      'info depth 11 seldepth 13 multipv 1 score mate 3 nodes 1 pv d8h4',
      'bestmove d8h4 ponder g2g3',
    ];
    const r = parseSearch(out, false); // Black to move
    expect(r.bestmove).toBe('d8h4');
    expect(r.mate).toBe(-3);
    expect(r.lines!.map((l) => l.move)).toEqual(['d8h4', 'c7c5']);
    expect(r.lines![1].cp).toBe(-18);
    expect(r.depth).toBe(11);
  });
});
