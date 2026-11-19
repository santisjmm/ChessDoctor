// Renders public/og.png (1200x630), the link-preview image for every page and share link.
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { chromium } from 'playwright';

const nm = (p) => new URL(`../node_modules/${p}`, import.meta.url);
const fontUrl = (w) => `data:font/woff2;base64,${readFileSync(nm(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`)).toString('base64')}`;
// cburnett pieces (GPLv2+), as embedded in chessground's CSS.
const css = readFileSync(nm('chessground/assets/chessground.cburnett.css'), 'utf8');
const piece = {};
for (const m of css.matchAll(/piece\.(pawn|knight|bishop|rook|queen|king)\.(white|black)\s*\{\s*background-image:\s*url\('([^']+)'\)/g))
  piece[(m[2] === 'white' ? 'w' : 'b') + { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }[m[1]]] = m[3];
// Red 5...h6?! vs green 5...a6 (Najdorf) in:  1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3, Black to move.
const chess = new Chess();
for (const m of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3']) chess.move(m);
const sq = (i) => ((Math.floor(i / 8) + (i % 8)) % 2 ? '#a98a66' : '#ebdfc8');
const board = chess.board().flat().map((p, i) =>
  `<i style="background:${sq(i)}">${p ? `<img src="${piece[p.color + p.type]}">` : ''}</i>`).join('');
const font = '';
const html = `<!doctype html><html><head><style>
@font-face { font-family: Inter; font-weight: 400; src: url(${fontUrl(400)}); }
@font-face { font-family: Inter; font-weight: 800; src: url(${fontUrl(800)}); }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; font-family: Inter; color: #f4f5f7; background: linear-gradient(135deg, #1f232b, #15171c);
  display: grid; grid-template-columns: 1fr 400px; align-items: center; gap: 60px; padding: 0 80px; }
.mark { font-weight: 800; font-size: 34px; color: #9aa3b2; }
h1 { font-weight: 800; font-size: 72px; line-height: 1.02; letter-spacing: -0.03em; margin: 22px 0 26px; }
h1 b { color: #ff6b6b; }
p { font-size: 30px; color: #9aa3b2; line-height: 1.35; }
.url { margin-top: 34px; font-size: 26px; color: #4cc38a; font-weight: 800; }
.board { width: 400px; height: 400px; display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); border-radius: 18px; overflow: hidden; position: relative; }
.board i { display: block; }
.board img { width: 100%; height: 100%; display: block; }
.arrow { position: absolute; inset: 0; }
</style></head><body>
<div><div class="mark">ChessDoctor</div><h1>Find the <b>leak</b> in your openings.</h1>
<p>A free report card from your Lichess or Chess.com games. Then train the move you keep getting wrong.</p>
<div class="url">chessdoctor.app</div></div>
<div class="board">${board}<svg class="arrow" viewBox="0 0 8 8">
<path d="M0.5 1.5 L0.5 2.05" stroke="rgba(40,170,100,.95)" stroke-width=".16" stroke-linecap="round"/><path d="M0.5 2.5 L0.78 2.0 L0.22 2.0Z" fill="rgba(40,170,100,.95)"/>
<path d="M7.5 1.5 L7.5 2.05" stroke="rgba(230,70,70,.9)" stroke-width=".16" stroke-linecap="round"/><path d="M7.5 2.5 L7.78 2.0 L7.22 2.0Z" fill="rgba(230,70,70,.9)"/>
</svg></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
await browser.close();
console.log('public/og.png written');
