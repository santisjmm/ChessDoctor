import { describe, expect, it } from 'vitest';
import { mostCommonPlayer, parsePgn, toGames } from '../src/lib/pgn';

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.02"]
[White "Me_Player"]
[Black "BotNelson"]
[Result "1-0"]
[TimeControl "600"]
[WhiteElo "1200"]

1. e4 {[%clk 0:09:58]} e5 2. Nf3 Nc6 3. Bc4 Nf6?? 4. Ng5 d5 1-0

[Event "Casual"]
[White "Someone"]
[Black "me_player"]
[Result "1/2-1/2"]
[TimeControl "180+2"]

1. d4 d5 2. c4 c6 1/2-1/2

[Event "Odds"]
[White "me_player"]
[Black "x"]
[SetUp "1"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w Qkq - 0 1"]
[Result "1-0"]

1. e4 e5 1-0

[Event "Other people"]
[White "a"]
[Black "b"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1
`;

describe('PGN import', () => {
  const parsed = parsePgn(PGN);
  it('splits games and skips custom start positions', () => {
    expect(parsed.games).toHaveLength(3);
    expect(parsed.skipped).toBe(1);
    expect(parsed.games[0].moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5']);
  });
  it('guesses the user and converts to their point of view', () => {
    expect(mostCommonPlayer(parsed.games)?.toLowerCase()).toBe('me_player');
    const { games, notMine } = toGames(parsed.games, 'ME_PLAYER');
    expect(notMine).toBe(1);
    expect(games.map((g) => [g.color, g.score, g.speed])).toEqual([['w', 1, 'rapid'], ['b', 0.5, 'blitz']]);
    expect(games[0]).toMatchObject({ site: 'pgn', user: 'me_player', opponent: 'BotNelson', userRating: 1200 });
    expect(games[0].playedAt).toBe(Date.parse('2026-11-02T12:00:00Z'));
  });
  it('gives the same game the same id', () => {
    expect(toGames(parsePgn(PGN).games, 'me_player').games[0].id).toBe(toGames(parsed.games, 'me_player').games[0].id);
  });
});
