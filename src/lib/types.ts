export type Site = 'lichess' | 'chesscom';
export type Color = 'w' | 'b';

/** One game, from the importing user's point of view. */
export interface Game {
  id: string; // `${site}:${siteId}`
  site: Site;
  user: string; // lower-case username on that site
  color: Color; // colour the user played
  score: 1 | 0.5 | 0; // user's result
  playedAt: number; // ms epoch (game end)
  speed: string; // bullet / blitz / rapid / classical / daily
  rated: boolean;
  userRating?: number;
  oppRating?: number;
  opponent: string;
  moves: string[]; // SAN, whole game
  url: string;
}

export interface ImportProgress {
  site: Site;
  fetched: number;
  target: number;
  note?: string;
}
