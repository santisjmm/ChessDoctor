// Draws the shareable "Opening report card" on a canvas and exports it as a PNG.
import piecesCss from 'chessground/assets/chessground.cburnett.css?raw';
import { APP_NAME, APP_URL } from '../config';
import type { Color } from './types';

export type CardFormat = 'portrait' | 'wide';
export const CARD_SIZES: Record<CardFormat, [number, number]> = { portrait: [1080, 1350], wide: [1200, 630] };

export interface CardData {
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
  bg1: '#15171c',
  bg2: '#1f232b',
  text: '#f4f5f7',
  muted: '#9aa3b2',
  green: '#4cc38a',
  red: '#ff6b6b',
  light: '#ebdfc8',
  dark: '#a98a66',
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

const bestLine = (b: NonNullable<CardData['best']>) => `${role(b.family, b.color)} · ${signedPct(b.diff)} vs your average · ${b.n} games`;
const leakTitle = (l: NonNullable<CardData['leak']>) => `${l.family}, move ${l.moveNo}`;
const leakLine = (l: NonNullable<CardData['leak']>) =>
  l.diff < 0 || l.drop === null
    ? `${role(l.family, l.color)} · you lose ${pct(l.lossRate)} · ${signedPct(l.diff)} vs avg`
    : `${role(l.family, l.color)} · gives away ${Math.round(l.drop)}% win chance each time`;
const verdictLines = (v: CardData['verdict']): [string, string][] =>
  !v
    ? [[C.muted, 'Your moves hold up here.'], [C.muted, 'The games slip away later.']]
    : v.best
      ? [[C.red, `You play ${v.played}`], [C.green, `Better: ${v.best}`]]
      : [[C.text, `You play ${v.played}`], [C.muted, 'The engine is fine with it. The games slip away later.']];

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

async function portrait(ctx: CanvasRenderingContext2D, w: number, h: number, d: CardData) {
  const P = 72, inner = w - 2 * P;
  ctx.fillStyle = C.muted;
  ctx.font = font(28, 700);
  tracked(ctx, 'OPENING REPORT CARD', P, 118, 5);
  ctx.fillStyle = C.text;
  ctx.fillText(fitText(ctx, d.name, inner, 76, 800), P, 205);
  ctx.fillStyle = C.muted;
  ctx.fillText(fitText(ctx, d.subtitle, inner, 30, 400), P, 255);

  // Best opening
  let y = 305;
  panel(ctx, P, y, inner, 215, C.green);
  ctx.fillStyle = C.green;
  ctx.font = font(26, 700);
  tracked(ctx, 'YOUR BEST OPENING', P + 48, y + 62, 3);
  ctx.fillStyle = C.text;
  if (d.best) {
    ctx.fillText(fitText(ctx, d.best.family, inner - 96, 56, 800), P + 48, y + 132);
    ctx.fillStyle = C.muted;
    ctx.fillText(fitText(ctx, bestLine(d.best), inner - 96, 30, 400), P + 48, y + 180);
  } else {
    ctx.font = font(36, 600);
    ctx.fillText('Play a few more games', P + 48, y + 135);
  }

  // Leak
  y = 550;
  const leakH = 650;
  panel(ctx, P, y, inner, leakH, C.red);
  ctx.fillStyle = C.red;
  ctx.font = font(26, 700);
  tracked(ctx, 'YOUR LEAK', P + 48, y + 62, 3);
  ctx.fillStyle = C.text;
  if (d.leak) {
    ctx.fillText(fitText(ctx, leakTitle(d.leak), inner - 96, 56, 800), P + 48, y + 132);
    ctx.fillStyle = C.muted;
    ctx.fillText(fitText(ctx, leakLine(d.leak), inner - 96, 30, 400), P + 48, y + 180);
    const bs = 400, bx = P + 48, by = y + 214;
    if (d.verdict) await drawBoard(ctx, bx, by, bs, d.verdict);
    const tx = bx + bs + 44, tw = inner - 96 - bs - 44;
    let ty = by + 60;
    for (const [color, text] of verdictLines(d.verdict)) {
      ctx.fillStyle = color;
      ctx.font = font(36, 700);
      for (const line of wrap(ctx, text, tw)) {
        ctx.fillText(line, tx, ty);
        ty += 46;
      }
      ty += 18;
    }
    ctx.fillStyle = C.muted;
    ctx.font = font(28, 400);
    for (const line of wrap(ctx, `You reached this position in ${d.leak.reached} games.`, tw)) {
      ctx.fillText(line, tx, ty + 10);
      ty += 38;
    }
  } else {
    ctx.font = font(36, 600);
    ctx.fillText('No leak found. Nice.', P + 48, y + 135);
  }

  // Footer
  ctx.fillStyle = C.muted;
  ctx.font = font(26, 600);
  ctx.fillText(APP_NAME, P, h - 72);
  ctx.font = font(26, 400);
  const url = `Get yours free at ${APP_URL}`;
  ctx.fillText(url, w - P - ctx.measureText(url).width, h - 72);
}

async function wide(ctx: CanvasRenderingContext2D, w: number, h: number, d: CardData) {
  const P = 52, bs = 470, bx = w - P - bs, by = (h - bs) / 2 - 14;
  const colW = bx - P - 40;
  ctx.fillStyle = C.muted;
  ctx.font = font(20, 700);
  tracked(ctx, 'OPENING REPORT CARD', P, 74, 4);
  ctx.fillStyle = C.text;
  ctx.fillText(fitText(ctx, d.name, colW, 52, 800), P, 132);
  ctx.fillStyle = C.muted;
  ctx.fillText(fitText(ctx, d.subtitle, colW, 22, 400), P, 166);

  const block = (y: number, label: string, accent: string, title: string, sub: string) => {
    ctx.fillStyle = accent;
    ctx.fillRect(P, y, 6, 110);
    ctx.font = font(18, 700);
    tracked(ctx, label, P + 26, y + 26, 3);
    ctx.fillStyle = C.text;
    ctx.fillText(fitText(ctx, title, colW - 26, 38, 800), P + 26, y + 72);
    ctx.fillStyle = C.muted;
    ctx.fillText(fitText(ctx, sub, colW - 26, 21, 400), P + 26, y + 104);
  };
  block(206, 'YOUR BEST OPENING', C.green, d.best?.family ?? 'Play a few more games', d.best ? bestLine(d.best) : '');
  if (d.leak) {
    const v = verdictLines(d.verdict).map(([, t]) => t).join(' · ');
    block(356, 'YOUR LEAK', C.red, leakTitle(d.leak), leakLine(d.leak));
    ctx.fillStyle = C.text;
    ctx.fillText(fitText(ctx, v, colW - 26, 24, 600), P + 26, 506);
  } else block(356, 'YOUR LEAK', C.red, 'No leak found. Nice.', '');

  if (d.verdict) await drawBoard(ctx, bx, by, bs, d.verdict);
  ctx.fillStyle = C.muted;
  ctx.font = font(20, 600);
  ctx.fillText(APP_NAME, P, h - 30);
  ctx.font = font(20, 400);
  const url = `Get yours free at ${APP_URL}`;
  ctx.fillText(url, bx + bs - ctx.measureText(url).width, h - 30);
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
