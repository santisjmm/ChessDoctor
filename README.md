# ChessDoctor

Training built from your own games, focused on repairing your openings. A static PWA:
everything (game import, opening book, Stockfish) runs on the user's device.

**Milestone 1, the free Opening report card:** enter a Lichess and/or Chess.com username
and get a shareable card (best opening, your leak, the better move) built from the last 300
games, with no sign-up, plus a first drill of the leak line.

**Milestone 2, the trainer:** returning users open on **Today** (about 10 minutes of due drills
and a streak). **Openings** is a per-colour explorer of what you actually play: games, score
against your average, where you leave the book, and engine verdicts. A flagged move shows the
better move, why, and the games where it went wrong. **Drills** use Leitner spaced repetition
(1/3/7/16/35 days; a slip comes back in 10 minutes). Stockfish keeps checking your 60
most-repeated moves in the background while the app is open.

**Since then:** a responsive layout (phone, tablet, desktop with sidebar and board|panel),
share links (`/r/l/<user>`, `/r/c/<user>`), and features ported from the owner's Review app:
whole-game review (move classification, chess.com-calibrated accuracy, Game Rating, key
moments, variation mode), My mistakes puzzles from reviewed games, Learn an opening from the
book, PGN import and a Results tab (time controls, rating over time, score vs rating gap).

**Look and layout** follow the owner's Review app: its stylesheet is the base (`src/styles/review.css`,
ChessDoctor-specific styles in `src/styles/app.css`), with the same tabs (Games, Train, Stats, Settings),
game review layout, class badges and board colours.

## How it works

| Piece | Where it runs |
| --- | --- |
| Game import | Browser → public Lichess API (NDJSON stream, `since=` for incremental) and Chess.com PubAPI (monthly archives, newest first). One request at a time per host, 60 s back-off on 429. |
| Opening book | `public/book.json`, built from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0) by `npm run book`. Every position on a named line counts as book. |
| Engine | Stockfish 19 lite, single-threaded WASM (`public/engine/`, copied from the `stockfish` npm package by `npm run engine`). Web Worker, UCI, depth 12 / 700 ms cap. No COOP/COEP headers needed. |
| Storage | IndexedDB (Dexie): games, import state, per-game opening analysis, engine evals cache, drills, attempts. |
| Card | Canvas → PNG (1080×1350 phone, 1200×630 wide). Web Share API with files, falling back to a download. |

**Finding the leak** (`src/lib/report.ts`, `src/lib/pipeline.ts`):
1. Each game is replayed against the book: the deepest named opening and the first out-of-book ply.
2. Openings are grouped by colour and family ("London System" is lifted out of "Queen's Pawn Game: …"), and scored against the user's average with that colour.
3. The user's repeated out-of-book moves (≥3 games, first 10 moves) are screened by Stockfish. The leak is the repeated inaccuracy (≥5% win chance lost, Lichess's threshold) that costs the most points. If there is none, the leak is the opening that costs the most points against the user's average.

## Develop

No system Node is needed: a portable Node lives in `.tools/` (git-ignored).

```sh
. .tools/env.sh          # puts .tools/node/bin on PATH
npm install
npm run engine           # copy Stockfish WASM into public/engine/
npm run dev              # http://localhost:5173
npm test                 # unit tests
LIVE=1 npx vitest run tests/live.test.ts   # hits the real APIs
npm run build && npx vite preview --port 4173
PLAYWRIGHT_BROWSERS_PATH=.tools/pw VIEWPORT=desktop|phone CHESSCOM=<user> node scripts/look.mjs   # every tab, a review, a drill → shots/
PLAYWRIGHT_BROWSERS_PATH=.tools/pw CHESSCOM=<user> node scripts/card-check.mjs   # both card PNGs → shots/cards/
```

Branding lives in `src/config.ts` (name, URL) and the PWA manifest in `vite.config.ts`. The IndexedDB database keeps its original internal name `opening-trainer` so data already on devices survives.

## Deploy

Live at **https://chessdoctor.app** (Cloudflare Pages project `chessdoctor`, classic Pages,
direct upload; `public/_headers` sets the CSP and caching). Deploy with a Cloudflare API token
scoped to Pages: Edit (account) in `CLOUDFLARE_API_TOKEN` and the account in `CLOUDFLARE_ACCOUNT_ID`:

```sh
npm run deploy
```

Check a deploy end to end: `PLAYWRIGHT_BROWSERS_PATH=.tools/pw CHESSCOM=<user> node scripts/look.mjs https://chessdoctor.app/`.
Automated checks use Chess.com accounts only: Lichess refuses headless browsers, and that is respected.

## Licence

GPL-3.0-or-later (see `LICENSE`). Stockfish is GPLv3, and shipping its WASM to browsers is
distribution, so the whole client app is GPL and its source will be published at launch
(link on the About page). Server-side pieces (e.g. the future licence-check Worker) are not
distributed and may stay private. Third-party licences are listed in the app's About page.
