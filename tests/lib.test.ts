import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Book, type BookData } from '../src/lib/book';
import { parseChesscomGame, pgnMoves, type ChesscomGame } from '../src/lib/chesscom';
import { parseLichessGame, type LichessGame } from '../src/lib/lichess';
import { analyseOpening, moveNumber } from '../src/lib/openings';
import { buildReport, commonContinuation, decisionNodes, leakFromNode, minGamesFor, score } from '../src/lib/report';
import type { Game } from '../src/lib/types';

const book = new Book(JSON.parse(readFileSync('public/book.json', 'utf8')) as BookData);

let seq = 0;
function game(color: 'w' | 'b', score: 1 | 0.5 | 0, moves: string): Game {
  return {
    id: `t:${seq++}`, site: 'lichess', user: 'me', color, score, playedAt: seq * 1000, speed: 'blitz',
    rated: true, opponent: 'x', moves: moves.split(' '), url: '',
  };
}

describe('pgnMoves', () => {
  it('strips tags, clocks, numbers and result', () => {
    const pgn = '[Event "Live"]\n[White "a"]\n\n1. e4 {[%clk 0:02:59.9]} 1... c5 {[%clk 0:02:58]} 2. Nf3?! d6 $1 (2... Nc6 3. d4) 3. d4 1-0';
    expect(pgnMoves(pgn)).toEqual(['e4', 'c5', 'Nf3', 'd6', 'd4']);
  });
});

describe('parsers', () => {
  it('lichess: user perspective, skips non-standard', () => {
    const raw: LichessGame = {
      id: 'abc', rated: true, variant: 'standard', speed: 'blitz', createdAt: 1, lastMoveAt: 2, status: 'mate',
      players: { white: { user: { name: 'Foo', id: 'foo' }, rating: 1500 }, black: { user: { name: 'Me', id: 'me' }, rating: 1600 } },
      winner: 'black', moves: 'e4 c5',
    };
    const g = parseLichessGame(raw, 'Me')!;
    expect(g).toMatchObject({ color: 'b', score: 1, opponent: 'Foo', moves: ['e4', 'c5'], userRating: 1600 });
    expect(parseLichessGame({ ...raw, variant: 'chess960' }, 'me')).toBeNull();
    expect(parseLichessGame({ ...raw, status: 'aborted' }, 'me')).toBeNull();
    expect(parseLichessGame({ ...raw, winner: undefined, status: 'draw' }, 'me')!.score).toBe(0.5);
  });
  it('chess.com: result codes', () => {
    const raw: ChesscomGame = {
      url: 'https://www.chess.com/game/live/123', pgn: '1. d4 d5 2. c4 *', end_time: 100, rated: true, time_class: 'rapid', rules: 'chess',
      white: { username: 'Me', result: 'repetition' }, black: { username: 'Opp', result: 'repetition' },
    };
    expect(parseChesscomGame(raw, 'me')).toMatchObject({ id: 'chesscom:123', color: 'w', score: 0.5, playedAt: 100000 });
    expect(parseChesscomGame({ ...raw, white: { username: 'Me', result: 'timeout' } }, 'me')!.score).toBe(0);
    expect(parseChesscomGame({ ...raw, rules: 'chess960' }, 'me')).toBeNull();
  });
});

describe('familyOf', () => {
  it('lifts systems out of catch-all families', async () => {
    const { familyOf } = await import('../src/lib/book');
    expect(familyOf("Queen's Pawn Game: Accelerated London System, Steinitz Countergambit")).toBe('London System');
    expect(familyOf('Indian Defense: London System')).toBe('London System');
    expect(familyOf('London System, with Bd3')).toBe('London System');
    expect(familyOf("Queen's Pawn Game: Chigorin Variation")).toBe("Queen's Pawn Game");
    expect(familyOf('Sicilian Defense: Najdorf Variation')).toBe('Sicilian Defense');
  });
});

describe('analyseOpening', () => {
  it('names the deepest book position and finds the exit', () => {
    // Caro-Kann Advance, then 4. a3?! is out of book... (check what the book says)
    const o = analyseOpening(game('b', 0, 'e4 c6 d4 d5 e5 Bf5 Qh5 g6 Qg4'), book);
    expect(o.opening?.family).toBe('Caro-Kann Defense');
    expect(o.exitPly).toBe(6); // Qh5 is the 7th ply
    expect(o.exitBy).toBe('opp');
    expect(moveNumber(o.exitPly)).toBe(4);
  });
  it('handles a game that never leaves book within the window', () => {
    const o = analyseOpening(game('w', 1, 'e4 e5'), book);
    expect(o.exitBy).toBeNull();
  });
  it('stops on a malformed move', () => {
    const o = analyseOpening(game('w', 1, 'e4 e5 Zz9 Nf3'), book);
    expect(o.sans).toEqual(['e4', 'e5']);
  });
});

describe('buildReport', () => {
  const games: Game[] = [];
  // London as White: 10 games, 9 wins.
  for (let i = 0; i < 10; i++) games.push(game('w', i < 9 ? 1 : 0, 'd4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6'));
  // Other White games: 10 games, 50%.
  for (let i = 0; i < 10; i++) games.push(game('w', i % 2 ? 1 : 0, 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6'));
  // Sicilian as Black: 12 games, lost 10, mostly in one line where I play 6...Qb6?!.
  for (let i = 0; i < 8; i++) games.push(game('b', 0, 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 h6 Bh4'));
  for (let i = 0; i < 4; i++) games.push(game('b', i < 2 ? 0 : 1, 'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7'));
  // French as Black: 10 games, 70%.
  for (let i = 0; i < 10; i++) games.push(game('b', i < 7 ? 1 : 0, 'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7'));
  const report = buildReport(games.map((g) => analyseOpening(g, book)));

  it('tallies by colour', () => {
    expect(report.total).toBe(42);
    expect(report.byColor.w.n).toBe(20);
    expect(score(report.byColor.w)).toBeCloseTo(14 / 20);
  });
  it('finds the best opening and the leak', () => {
    // French: 70% vs Black average 41% (+29) beats London: 90% vs White average 70% (+20).
    expect(report.best?.family).toBe('French Defense');
    const london = report.openings.find((o) => o.family === 'London System')!;
    expect(london.color).toBe('w');
    expect(london.diff).toBeCloseTo(0.2);
    expect(report.leak?.stat.family).toBe('Sicilian Defense');
    expect(report.leak?.stat.color).toBe('b');
    // The 8 lost Najdorf-ish games are where the points go.
    expect(report.leak?.lineTally.n).toBe(8);
    expect(report.leak?.lineTally.losses).toBe(8);
    expect(report.leak?.path.slice(0, 3)).toEqual(['e4', 'c5', 'Nf3']);
  });
  it('extends the leak line with the common continuation', () => {
    const cont = commonContinuation(report.leak!);
    expect(cont.length).toBeGreaterThan(report.leak!.line.length);
    expect(cont.slice(0, report.leak!.line.length)).toEqual(report.leak!.line);
  });
  it('lists repeated out-of-book user moves, most frequent first', () => {
    const items = games.map((g) => analyseOpening(g, book));
    const nodes = decisionNodes(items, 3);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => n.tally.n >= 3)).toBe(true);
    expect(nodes.every((n) => (n.ply % 2 === 0 ? 'w' : 'b') === n.color)).toBe(true);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i - 1].tally.n).toBeGreaterThanOrEqual(nodes[i].tally.n);
    // Every node is out of book for the games in it.
    for (const n of nodes) expect(n.items.every((it) => it.exitPly <= n.ply)).toBe(true);
    const leak = leakFromNode(nodes[0], report);
    expect(leak.path.slice(0, leak.line.length)).toEqual(leak.line);
    expect(leak.stat.color).toBe(nodes[0].color);
  });
  it('scales the minimum sample', () => {
    expect(minGamesFor(300)).toBe(12);
    expect(minGamesFor(40)).toBe(5);
    expect(minGamesFor(2000)).toBe(15);
  });
});

describe('card wording', () => {
  it('says "against it" for the opponent\'s opening', async () => {
    const { role } = await import('../src/lib/card');
    expect(role('Modern Defense', 'w')).toBe('as White, against it');
    expect(role('Modern Defense', 'b')).toBe('as Black');
    expect(role('London System', 'b')).toBe('as Black, against it');
    expect(role('Ruy Lopez', 'b')).toBe('as Black');
    expect(role("King's Gambit", 'b')).toBe('as Black, against it');
  });
});
