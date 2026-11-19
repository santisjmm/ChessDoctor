// Draws the shareable "Opening report card" on a canvas and exports it as a PNG.
import piecesCss from 'chessground/assets/chessground.cburnett.css?raw';
import { APP_NAME, APP_URL } from '../config';
import type { Color } from './types';

export type CardFormat = 'portrait' | 'wide';
export const CARD_SIZES: Record<CardFormat, [number, number]> = { portrait: [1080, 1350], wide: [1200, 630] };

export interface CardStatRow {
  family: string;
  n: number;
  score: number;
  diff: number;
}

export interface CardData {
  /** Current and peak rating per site and time control (most games first, up to 3). */
  ratings: { label: string; now: number; peak: number }[];
  results: { n: number; wins: number; draws: number; losses: number; score: number; white: number; black: number };
  /** Top openings by games, per colour (up to 3 each). */
  repertoire: { w: CardStatRow[]; b: CardStatRow[] };
  facts: {
    bookExitMove: number | null; // average move at which the user's games leave the book
    openingAccuracy: number | null; // mean accuracy of the opening phase (checked games)
    openingAccuracyGames: number;
    vsStronger: { n: number; score: number; expected: number } | null; // opponents 100+ higher
    winStreak: number; // longest run of wins in these games
  };
  name: string;
  subtitle: string; // "Lichess + Chess.com · 300 games · Mar–Nov 2026"
  best: { family: string; color: Color; diff: number; score: number; n: number } | null;
  leak: {
    family: string;
    color: Color;
    moveNo: number;
    n: number;
    score: number;
    lossRate: number;
    diff: number;
    /** Games that reached the position shown. */
    reached: number;
    /** Win% the repeated move gives away (engine), when there is one. */
    drop: number | null;
  } | null;
  verdict: { fen: string; orientation: Color; played: string; best: string | null; playedUci: string; bestUci: string | null } | null;
}

const C = {
  bg1: '#1b1a18',
  bg2: '#262522',
  panel: 'rgba(255,255,255,0.045)',
  text: '#f0efec',
  text2: '#c3c2b7',
  muted: '#98968f',
  green: '#84bd4f',
  win: '#4caf50',
  draw: '#9a9890',
  red: '#e05252',
  light: '#ebecd0',
  dark: '#739552',
};
const FONT = 'Inter, system-ui, sans-serif';
const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT}`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;
const side = (c: Color) => (c === 'w' ? 'White' : 'Black');

/** Which side an opening's name belongs to, when the name says so. */
export function openingSide(family: string): Color | null {
  if (/Defen[cs]e|Countergambit/.test(family)) return 'b';
  if (/Opening|Attack|System|Gambit$/.test(family)) return 'w';
  return null;
}
/** "as White" or, when the opening is the opponent's, "as White, against it". */
export const role = (family: string, c: Color) => {
  const s = openingSide(family);
  return s && s !== c ? `as ${side(c)}, against it` : `as ${side(c)}`;
};

// --- pieces -------------------------------------------------------------------------------
let piecesP: Promise<Record<string, HTMLImageElement>> | null = null;
const pieceImgs = () => (piecesP ??= (async () => {
  const out: Record<string, HTMLImageElement> = {};
  const re = /piece\.(pawn|knight|bishop|rook|queen|king)\.(white|black)\s*\{\s*background-image:\s*url\('([^']+)'\)/g;
  const loads: Promise<void>[] = [];
  for (const m of piecesCss.matchAll(re)) {
    const code = (m[2] === 'white' ? 'w' : 'b') + { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }[m[1]]!;
    const img = new Image();
    img.src = m[3];
    out[code] = img;
    loads.push(img.decode().catch(() => undefined));
  }
  await Promise.all(loads);
  return out;
})());

export async function cardReady() {
  await Promise.all([
    pieceImgs(),
    document.fonts.load(font(40, 400)),
    document.fonts.load(font(40, 600)),
    document.fonts.load(font(40, 800)),
  ]);
}

// --- drawing helpers ----------------------------------------------------------------------
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number, min = size * 0.6) {
  let s = size;
  ctx.font = font(s, weight);
  while (ctx.measureText(text).width > maxW && s > min) {
    s -= 2;
    ctx.font = font(s, weight);
  }
  if (ctx.measureText(text).width > maxW) {
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    text += '…';
  }
  return text;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 28);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(x, y, 10, h, [28, 0, 0, 28]);
  ctx.fill();
}

const sq = (s: string, o: Color) => {
  const f = s.charCodeAt(0) - 97;
  const r = Number(s[1]) - 1;
  return o === 'w' ? [f, 7 - r] : [7 - f, r];
};

async function drawBoard(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, v: NonNullable<CardData['verdict']>) {
  const imgs = await pieceImgs();
  const s = size / 8;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 14);
  ctx.clip();
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      ctx.fillStyle = (r + f) % 2 ? C.dark : C.light;
      ctx.fillRect(x + f * s, y + r * s, s, s);
    }
  const highlight = (uci: string, color: string) => {
    for (const q of [uci.slice(0, 2), uci.slice(2, 4)]) {
      const [cx, cy] = sq(q, v.orientation);
      ctx.fillStyle = color;
      ctx.fillRect(x + cx * s, y + cy * s, s, s);
    }
  };
  const neutral = !v.bestUci;
  highlight(v.playedUci, neutral ? 'rgba(120,160,255,0.30)' : 'rgba(255,90,90,0.35)');
  if (v.bestUci) highlight(v.bestUci, 'rgba(70,200,130,0.35)');
  const rows = v.fen.split(' ')[0].split('/');
  rows.forEach((row, ri) => {
    let fi = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        fi += Number(ch);
        continue;
      }
      const code = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase();
      const square = String.fromCharCode(97 + fi) + (8 - ri);
      const [cx, cy] = sq(square, v.orientation);
      const img = imgs[code];
      if (img) ctx.drawImage(img, x + cx * s, y + cy * s, s, s);
      fi++;
    }
  });
  ctx.restore();
  arrow(ctx, x, y, s, v.playedUci, v.orientation, neutral ? 'rgba(90,130,230,0.85)' : 'rgba(230,70,70,0.9)');
  if (v.bestUci) arrow(ctx, x, y, s, v.bestUci, v.orientation, 'rgba(40,170,100,0.95)');
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, uci: string, o: Color, color: string) {
  const [fx, fy] = sq(uci.slice(0, 2), o);
  const [tx, ty] = sq(uci.slice(2, 4), o);
  const ax = x + (fx + 0.5) * s, ay = y + (fy + 0.5) * s;
  const bx = x + (tx + 0.5) * s, by = y + (ty + 0.5) * s;
  const ang = Math.atan2(by - ay, bx - ax);
  const head = s * 0.42;
  const ex = bx - Math.cos(ang) * head * 0.9, ey = by - Math.sin(ang) * head * 0.9;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - Math.cos(ang - 0.5) * head, by - Math.sin(ang - 0.5) * head);
  ctx.lineTo(bx - Math.cos(ang + 0.5) * head, by - Math.sin(ang + 0.5) * head);
  ctx.closePath();
  ctx.fill();
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, C.bg2);
  g.addColorStop(1, C.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// --- layouts ------------------------------------------------------------------------------
export async function drawCard(canvas: HTMLCanvasElement, d: CardData, format: CardFormat) {
  await cardReady();
  const [w, h] = CARD_SIZES[format];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';
  background(ctx, w, h);
  if (format === 'portrait') await portrait(ctx, w, h, d);
  else await wide(ctx, w, h, d);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 22) {
  ctx.fillStyle = C.panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = C.muted) {
  ctx.fillStyle = color;
  ctx.font = font(size, 700);
  tracked(ctx, text, x, y, size * 0.12);
}

/** Rating tiles: "Blitz 1652 · peak 1712". */
function ratingTiles(ctx: CanvasRenderingContext2D, d: CardData, x: number, y: number, w: number, h: number, scale = 1) {
  if (!d.ratings.length) return false;
  const gap = 16 * scale;
  const tw = (w - gap * (d.ratings.length - 1)) / d.ratings.length;
  d.ratings.forEach((r, i) => {
    const tx = x + i * (tw + gap);
    box(ctx, tx, y, tw, h, 18 * scale);
    ctx.fillStyle = C.muted;
    ctx.font = font(22 * scale, 600);
    ctx.fillText(fitText(ctx, r.label, tw - 36 * scale, 22 * scale, 600), tx + 22 * scale, y + 38 * scale);
    ctx.fillStyle = C.text;
    ctx.font = font(48 * scale, 800);
    ctx.fillText(String(r.now), tx + 22 * scale, y + 90 * scale);
    ctx.fillStyle = C.muted;
    ctx.font = font(20 * scale, 400);
    ctx.fillText(r.peak > r.now ? `peak ${r.peak}` : 'at its peak', tx + 22 * scale, y + 124 * scale);
  });
  return true;
}

/** "300 games", a W/D/L bar and the score. */
function resultsStrip(ctx: CanvasRenderingContext2D, d: CardData, x: number, y: number, w: number, scale = 1) {
  const r = d.results;
  ctx.fillStyle = C.text;
  ctx.font = font(40 * scale, 800);
  const games = `${r.n.toLocaleString('en')} games`;
  ctx.fillText(games, x, y + 40 * scale);
  ctx.font = font(40 * scale, 800);
  const sc = `${pct(r.score)}`;
  const scW = ctx.measureText(sc).width;
  ctx.fillText(sc, x + w - scW, y + 40 * scale);
  ctx.fillStyle = C.muted;
  ctx.font = font(20 * scale, 600);
  ctx.fillText('score', x + w - scW - ctx.measureText('score ').width - 6, y + 38 * scale);
  // bar
  const by = y + 62 * scale, bh = 14 * scale;
  const segs: [number, string][] = [[r.wins, C.win], [r.draws, C.draw], [r.losses, C.red]];
  let bx = x;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, by, w, bh, bh / 2);
  ctx.clip();
  for (const [n, col] of segs) {
    const sw = r.n ? (n / r.n) * w : 0;
    ctx.fillStyle = col;
    ctx.fillRect(bx, by, Math.max(0, sw - 2), bh);
    bx += sw;
  }
  ctx.restore();
  ctx.fillStyle = C.text2;
  ctx.font = font(22 * scale, 400);
  ctx.fillText(`${r.wins} won · ${r.draws} drawn · ${r.losses} lost`, x, by + bh + 34 * scale);
  const cs = `White ${pct(r.white)} · Black ${pct(r.black)}`;
  ctx.fillText(cs, x + w - ctx.measureText(cs).width, by + bh + 34 * scale);
}

function verdictPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string, title: string, head: string, sub: string, scale = 1) {
  panel(ctx, x, y, w, h, accent);
  label(ctx, title, x + 34 * scale, y + 44 * scale, 20 * scale, accent);
  ctx.fillStyle = C.text;
  ctx.fillText(fitText(ctx, head, w - 60 * scale, 40 * scale, 800), x + 34 * scale, y + 96 * scale);
  ctx.fillStyle = C.muted;
  ctx.font = font(21 * scale, 400);
  let ty = y + 134 * scale;
  for (const line of wrap(ctx, sub, w - 60 * scale).slice(0, 2)) {
    ctx.fillText(line, x + 34 * scale, ty);
    ty += 28 * scale;
  }
}

function repertoire(ctx: CanvasRenderingContext2D, d: CardData, x: number, y: number, w: number, perColor = 3) {
  let ty = y;
  for (const c of ['w', 'b'] as const) {
    const rows = d.repertoire[c].slice(0, perColor);
    if (!rows.length) continue;
    label(ctx, c === 'w' ? 'AS WHITE' : 'AS BLACK', x, ty + 20, 18);
    ctx.fillStyle = C.muted;
    ctx.font = font(16, 600);
    ctx.fillText('games', x + w - 120 - ctx.measureText('games').width, ty + 20);
    ctx.fillText('score', x + w - ctx.measureText('score').width, ty + 20);
    ty += 34;
    for (const row of rows) {
      ctx.fillStyle = C.text;
      ctx.font = font(24, 600);
      ctx.fillText(fitText(ctx, row.family, w - 150, 24, 600), x, ty + 24);
      ctx.fillStyle = C.muted;
      ctx.font = font(20, 400);
      const n = `${row.n}`;
      ctx.fillText(n, x + w - 120 - ctx.measureText(n).width, ty + 24);
      ctx.fillStyle = row.n >= 5 && row.diff >= 0.03 ? C.win : row.n >= 5 && row.diff <= -0.03 ? C.red : C.text2;
      ctx.font = font(24, 700);
      const sc = pct(row.score);
      ctx.fillText(sc, x + w - ctx.measureText(sc).width, ty + 24);
      ty += 38;
    }
    ty += 8;
  }
}

const factLines = (d: CardData): [string, string][] => {
  const out: [string, string][] = [];
  if (d.facts.bookExitMove) out.push([`move ${d.facts.bookExitMove.toFixed(0)}`, 'you usually leave the book']);
  if (d.facts.openingAccuracy !== null) out.push([`${Math.round(d.facts.openingAccuracy)}%`, 'opening accuracy']);
  if (d.facts.vsStronger) out.push([pct(d.facts.vsStronger.score), `vs stronger players (exp. ${pct(d.facts.vsStronger.expected)})`]);
  if (out.length < 3 && d.facts.winStreak >= 3) out.push([`${d.facts.winStreak} wins`, 'longest winning streak']);
  return out;
};

const bestLine = (b: NonNullable<CardData['best']>) => `${role(b.family, b.color)} · ${signedPct(b.diff)} vs your average · ${b.n} games`;
const leakTitle = (l: NonNullable<CardData['leak']>) => `${l.family}, move ${l.moveNo}`;
const leakLine = (l: NonNullable<CardData['leak']>) =>
  l.diff < 0 || l.drop === null
    ? `${role(l.family, l.color)} · you lose ${pct(l.lossRate)} · ${signedPct(l.diff)} vs avg`
    : `${role(l.family, l.color)} · gives away ${Math.round(l.drop)}% win chance each time`;
const verdictText = (v: CardData['verdict']): [string, string][] =>
  !v ? [[C.muted, 'Your moves hold up here.']] : v.best ? [[C.red, `You play ${v.played}`], [C.win, `Better: ${v.best}`]] : [[C.text, `You play ${v.played}`], [C.muted, 'The engine is fine with it.']];

async function portrait(ctx: CanvasRenderingContext2D, w: number, h: number, d: CardData) {
  const P = 64, inner = w - 2 * P;
  label(ctx, 'OPENING REPORT CARD', P, 100, 24);
  ctx.fillStyle = C.text;
  ctx.fillText(fitText(ctx, d.name, inner, 68, 800), P, 176);
  ctx.fillStyle = C.muted;
  ctx.fillText(fitText(ctx, d.subtitle, inner, 26, 400), P, 220);

  let y = 250;
  if (ratingTiles(ctx, d, P, y, inner, 144)) y += 164;
  resultsStrip(ctx, d, P, y, inner);
  y += 138;

  // Best | Leak
  const half = (inner - 18) / 2;
  if (d.best) verdictPanel(ctx, P, y, half, 184, C.green, 'BEST OPENING', d.best.family, bestLine(d.best));
  else verdictPanel(ctx, P, y, half, 184, C.green, 'BEST OPENING', 'Play a few more', 'Needs more games in one opening.');
  if (d.leak) verdictPanel(ctx, P + half + 18, y, half, 184, C.red, 'YOUR LEAK', leakTitle(d.leak), leakLine(d.leak));
  else verdictPanel(ctx, P + half + 18, y, half, 184, C.red, 'YOUR LEAK', 'No leak found', 'Your openings hold up.');
  y += 204;

  // Board | repertoire
  const bs = 340;
  box(ctx, P, y, inner, bs + 40);
  if (d.verdict) await drawBoard(ctx, P + 20, y + 20, bs, d.verdict);
  const tx = P + 20 + bs + 30, tw = inner - bs - 70;
  let ty = y + 50;
  for (const [color, text] of verdictText(d.verdict)) {
    ctx.fillStyle = color;
    ctx.font = font(28, 700);
    ctx.fillText(fitText(ctx, text, tw, 28, 700), tx, ty);
    ty += 38;
  }
  if (d.leak) {
    ctx.fillStyle = C.muted;
    ctx.font = font(20, 400);
    ctx.fillText(fitText(ctx, `Reached in ${d.leak.reached} of your games`, tw, 20, 400), tx, ty);
  }
  repertoire(ctx, d, tx, ty + 14, tw, 2);
  y += bs + 60;

  // Facts
  const facts = factLines(d);
  if (facts.length) {
    const fw = (inner - 16 * (facts.length - 1)) / facts.length;
    facts.forEach(([big, small], i) => {
      const fx = P + i * (fw + 16);
      box(ctx, fx, y, fw, 96, 18);
      ctx.fillStyle = C.text;
      ctx.font = font(34, 800);
      ctx.fillText(fitText(ctx, big, fw - 40, 34, 800), fx + 22, y + 46);
      ctx.fillStyle = C.muted;
      ctx.font = font(19, 400);
      ctx.fillText(fitText(ctx, small, fw - 40, 19, 400), fx + 22, y + 76);
    });
  }

  // Footer
  ctx.fillStyle = C.text2;
  ctx.font = font(24, 700);
  ctx.fillText(APP_NAME, P, h - 36);
  ctx.fillStyle = C.muted;
  ctx.font = font(22, 400);
  const url = `Get yours free at ${APP_URL}`;
  ctx.fillText(url, w - P - ctx.measureText(url).width, h - 36);
}

async function wide(ctx: CanvasRenderingContext2D, w: number, h: number, d: CardData) {
  const P = 44, bs = 300, colW = w - 2 * P - bs - 36;
  label(ctx, 'OPENING REPORT CARD', P, 58, 16);
  ctx.fillStyle = C.text;
  ctx.fillText(fitText(ctx, d.name, colW, 44, 800), P, 106);
  ctx.fillStyle = C.muted;
  ctx.fillText(fitText(ctx, d.subtitle, colW, 18, 400), P, 134);
  let y = 154;
  if (ratingTiles(ctx, d, P, y, colW, 92, 0.68)) y += 108;
  resultsStrip(ctx, d, P, y, colW, 0.7);
  y += 110;
  const half = (colW - 12) / 2;
  if (d.best) verdictPanel(ctx, P, y, half, 136, C.green, 'BEST OPENING', d.best.family, bestLine(d.best), 0.68);
  if (d.leak) verdictPanel(ctx, P + half + 12, y, half, 136, C.red, 'YOUR LEAK', leakTitle(d.leak), leakLine(d.leak), 0.68);

  const bx = w - P - bs, by = 58;
  if (d.verdict) await drawBoard(ctx, bx, by, bs, d.verdict);
  let ty = by + bs + 40;
  for (const [color, text] of verdictText(d.verdict)) {
    ctx.fillStyle = color;
    ctx.font = font(22, 700);
    ctx.fillText(fitText(ctx, text, bs, 22, 700), bx, ty);
    ty += 30;
  }
  const facts = factLines(d).slice(0, 2);
  ctx.fillStyle = C.muted;
  ctx.font = font(16, 400);
  ctx.fillText(fitText(ctx, facts.map(([a, b]) => `${a} ${b}`).join(' · '), colW, 16, 400), P, h - 54);
  ctx.fillStyle = C.text2;
  ctx.font = font(18, 700);
  ctx.fillText(APP_NAME, P, h - 24);
  ctx.fillStyle = C.muted;
  ctx.font = font(17, 400);
  const url = `Get yours free at ${APP_URL}`;
  ctx.fillText(url, w - P - ctx.measureText(url).width, h - 24);
}

// --- export -------------------------------------------------------------------------------
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG export failed'))), 'image/png'));
}

/** Web Share API with the PNG when the device supports it; otherwise a download. */
export async function shareOrDownload(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
